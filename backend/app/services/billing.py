"""Buying a period of a paid plan with Razorpay Checkout (test mode), and an account's plan.

Flow:
1. POST /billing/checkout: the browser names a plan, never a price. The server takes the
   amount from the plan catalogue, creates an order with Razorpay and records it as a
   "created" payment. Nothing is granted.
2. The browser opens Razorpay Checkout for that order. When Checkout reports success it hands
   back the payment id and a signature.
3. POST /billing/checkout/verify: the server checks the signature against the order id it
   stored itself, then asks Razorpay for the payment and checks it is captured, on that order,
   for that amount and currency. Only then is the payment marked paid and a period of access
   created, in one transaction. A payment Razorpay has only authorized grants nothing yet.

Verifying again is harmless: an order already settled answers with what was recorded. No
transaction is held open while Razorpay is called.

A new period starts now, or when the account's latest active period ends, so paying early
adds time rather than replacing it. At most one period can be paid for in advance.
"""

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.billing.plans import CURRENCY, Plan, PlanId, plans
from app.billing.razorpay import (
    PaymentProvider,
    ProviderError,
    ProviderPayment,
    ProviderUnavailable,
)
from app.core.config import Settings
from app.models import Payment, Subscription, User
from app.models.enums import BillingProvider, PaymentStatus, SubscriptionStatus
from app.schemas.billing import (
    BillingAccount,
    CheckoutAvailability,
    CheckoutOrder,
    CheckoutResult,
    PaymentRead,
    PeriodRead,
)
from app.services.auth import Principal
from app.services.rate_limit import RateLimited, limiter

logger = logging.getLogger(__name__)

RECENT_PAYMENTS = 10
ACTIVE = SubscriptionStatus.ACTIVE.value


class BillingRefused(Exception):
    def __init__(
        self, code: str, message: str, status_code: int, retry_after: int | None = None
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.retry_after = retry_after


class BillingUnavailable(Exception):
    """Payments aren't set up, or Razorpay can't be reached (maps to 503)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


NOT_SET_UP = BillingUnavailable(
    "payments_not_configured", "Payments aren't set up on this Thread yet. Nothing was charged."
)


def _now() -> datetime:
    return datetime.now(UTC)


class BillingService:
    def __init__(
        self,
        db: Session,
        settings: Settings,
        provider: PaymentProvider | None,
        clock: Callable[[], datetime] = _now,
    ) -> None:
        self.db = db
        self.settings = settings
        self.provider = provider
        self.clock = clock
        self.plans = {p.id.value: p for p in plans(settings)}

    # --- reading ---------------------------------------------------------------------------

    def account(self, principal: Principal) -> BillingAccount:
        now = self.clock()
        periods = self.db.scalars(
            select(Subscription)
            .where(
                Subscription.user_id == principal.id,
                Subscription.status == ACTIVE,
                Subscription.ends_at > now,
            )
            .order_by(Subscription.starts_at)
        ).all()
        current = next((p for p in periods if p.starts_at <= now), None)
        upcoming = next((p for p in periods if p.starts_at > now), None)
        payments = self.db.scalars(
            select(Payment)
            .where(Payment.user_id == principal.id)
            .order_by(Payment.created_at.desc())
            .limit(RECENT_PAYMENTS)
        ).all()
        self.db.commit()
        return BillingAccount(
            plan_id=current.plan_id if current else PlanId.FREE.value,  # type: ignore[arg-type]
            exempt=principal.is_owner,
            current=self._period(current) if current else None,
            upcoming=self._period(upcoming) if upcoming else None,
            payments=[self._payment(p) for p in payments],
            checkout=CheckoutAvailability(
                available=self.provider is not None,
                provider=self.provider.name if self.provider else self.settings.payment_provider,
                mode=self.settings.razorpay_mode,
            ),
        )

    # --- buying ----------------------------------------------------------------------------

    def checkout(self, principal: Principal, plan_id: str) -> CheckoutOrder:
        if self.provider is None:
            raise NOT_SET_UP
        if principal.is_owner:
            raise BillingRefused("owner_exempt", "The owner of this Thread is never charged.", 403)
        if not principal.email_verified:
            raise BillingRefused(
                "email_not_verified", "Confirm your email address before buying a plan.", 403
            )
        plan = self._paid_plan(plan_id)
        try:
            limiter.hit(f"checkout:{principal.id}", self.settings.checkout_limit_per_hour, 3600)
        except RateLimited as exc:
            raise BillingRefused(
                "rate_limited",
                "Too many checkouts were started. Try again later.",
                429,
                exc.retry_after,
            ) from exc

        now = self.clock()
        if self._upcoming(principal.id, now) is not None:
            raise BillingRefused(
                "already_paid_ahead",
                "Your next period is already paid for. You can buy another once it starts.",
                409,
            )
        starts_at = self._next_start(principal.id, now)
        # End the read transaction: nothing is locked while Razorpay is called.
        self.db.commit()

        payment_id = uuid4()
        provider = self.provider
        try:
            order = provider.create_order(
                plan.price_paise,
                CURRENCY,
                # Unique per order (at most 40 characters), so a retried request is recognised.
                receipt=f"thr_{payment_id.hex}",
                # Ids only: no name, email or other personal details go to Razorpay here.
                notes={"thread_payment": str(payment_id), "plan": plan.id.value},
            )
        except ProviderUnavailable as exc:
            raise _unreachable() from exc
        except ProviderError as exc:
            raise _provider_failed() from exc
        if (order.amount_paise, order.currency) != (plan.price_paise, CURRENCY):
            logger.error("Razorpay order %s came back with another amount", order.id)
            raise _provider_failed()

        self.db.add(
            Payment(
                id=payment_id,
                user_id=principal.id,
                provider=BillingProvider.RAZORPAY.value,
                provider_order_id=order.id,
                plan_id=plan.id.value,
                amount_paise=plan.price_paise,
                currency=CURRENCY,
                period_days=self._period_days(plan),
                status=PaymentStatus.CREATED.value,
            )
        )
        self.db.commit()
        return CheckoutOrder(
            payment_id=payment_id,
            provider=provider.name,
            key_id=provider.key_id,
            order_id=order.id,
            amount_paise=plan.price_paise,
            currency=CURRENCY,
            plan_id=plan.id.value,  # type: ignore[arg-type]
            plan_name=plan.name,
            description=f"{plan.name}, {self._period_days(plan)} days",
            starts_at=starts_at,
        )

    def verify(
        self, principal: Principal, order_id: str, payment_id: str, signature: str
    ) -> CheckoutResult:
        if self.provider is None:
            raise NOT_SET_UP
        payment = self._own_payment(principal.id, order_id, lock=False)
        # The signature is checked against the order id Thread stored, not one it was sent.
        if not self.provider.signature_valid(payment.provider_order_id, payment_id, signature):
            logger.warning("Checkout signature did not match for payment %s", payment.id)
            raise BillingRefused(
                "signature_invalid", "This payment could not be confirmed. Nothing changed.", 400
            )
        # A failed attempt can be followed by a successful one on the same order.
        if payment.status not in (PaymentStatus.CREATED.value, PaymentStatus.FAILED.value):
            self.db.commit()
            return self._settled_result(payment)
        self.db.commit()

        try:
            remote = self.provider.fetch_payment(payment_id)
        except ProviderUnavailable as exc:
            raise _unreachable(CONFIRM_LATER) from exc
        except ProviderError as exc:
            raise _provider_failed(CONFIRM_LATER) from exc

        payment = self._own_payment(principal.id, order_id, lock=True)
        if payment.status in (PaymentStatus.PAID.value, PaymentStatus.REFUNDED.value):
            # Settled meanwhile (a repeated request, or later the webhook).
            self.db.commit()
            return self._settled_result(payment)
        if (remote.id, remote.order_id, remote.amount_paise, remote.currency) != (
            payment_id,
            payment.provider_order_id,
            payment.amount_paise,
            payment.currency,
        ):
            self.db.rollback()
            logger.error("Razorpay payment %s does not match payment %s", remote.id, payment.id)
            raise BillingRefused(
                "payment_mismatch", "This payment could not be confirmed. Nothing changed.", 400
            )
        return self._apply(payment, remote)

    # --- internals -------------------------------------------------------------------------

    def _apply(self, payment: Payment, remote: ProviderPayment) -> CheckoutResult:
        now = self.clock()
        if remote.status == "captured":
            payment.status = PaymentStatus.PAID.value
            payment.provider_payment_id = remote.id
            payment.method = remote.method
            payment.paid_at = now
            # An earlier attempt on this order may have failed; this one went through.
            payment.failed_at = None
            payment.failure_code = None
            assert payment.user_id is not None  # noqa: S101 (selected by user_id)
            # One account's payments are settled one at a time, so two can't both start now.
            self.db.execute(select(User.id).where(User.id == payment.user_id).with_for_update())
            starts_at = self._next_start(payment.user_id, now)
            period = Subscription(
                user_id=payment.user_id,
                payment_id=payment.id,
                plan_id=payment.plan_id,
                status=ACTIVE,
                starts_at=starts_at,
                ends_at=starts_at + timedelta(days=payment.period_days),
            )
            self.db.add(period)
            self.db.commit()
            logger.info("Payment %s verified; access period %s granted", payment.id, period.id)
            return CheckoutResult(status="paid", period=self._period(period))
        if remote.status == "failed":
            payment.status = PaymentStatus.FAILED.value
            payment.failed_at = payment.failed_at or now
            payment.failure_code = remote.error_code
            self.db.commit()
            return CheckoutResult(status="failed", period=None, failure_code=remote.error_code)
        if remote.status == "refunded":
            self.db.rollback()
            raise BillingRefused(
                "payment_refunded", "This payment was refunded, so it grants no access.", 409
            )
        # created or authorized: not captured yet, so nothing is granted. Razorpay captures it
        # (or refunds an authorization that is never captured); the webhook then settles it.
        self.db.rollback()
        return CheckoutResult(status="pending", period=None)

    def _settled_result(self, payment: Payment) -> CheckoutResult:
        if payment.status == PaymentStatus.FAILED.value:
            return CheckoutResult(status="failed", period=None, failure_code=payment.failure_code)
        period = self.db.scalar(select(Subscription).where(Subscription.payment_id == payment.id))
        return CheckoutResult(
            status="paid" if period is not None else "failed",
            period=self._period(period) if period is not None else None,
        )

    def _own_payment(self, user_id: UUID, order_id: str, *, lock: bool) -> Payment:
        query = select(Payment).where(
            Payment.provider_order_id == order_id, Payment.user_id == user_id
        )
        if lock:
            query = query.with_for_update()
        payment = self.db.scalar(query.execution_options(populate_existing=True))
        if payment is None:
            # Someone else's order reads exactly like one that doesn't exist.
            self.db.rollback()
            raise BillingRefused("payment_not_found", "No such checkout on this account.", 404)
        return payment

    def _upcoming(self, user_id: UUID, now: datetime) -> Subscription | None:
        return self.db.scalar(
            select(Subscription)
            .where(
                Subscription.user_id == user_id,
                Subscription.status == ACTIVE,
                Subscription.starts_at > now,
            )
            .limit(1)
        )

    def _next_start(self, user_id: UUID, now: datetime) -> datetime:
        latest = self.db.scalar(
            select(func.max(Subscription.ends_at)).where(
                Subscription.user_id == user_id, Subscription.status == ACTIVE
            )
        )
        return max(now, latest) if latest is not None else now

    def _paid_plan(self, plan_id: str) -> Plan:
        plan = self.plans.get(plan_id)
        if plan is None or plan.id == PlanId.FREE:
            raise BillingRefused("unknown_plan", "That plan can't be bought.", 422)
        return plan

    def _period_days(self, plan: Plan) -> int:
        assert plan.period_days is not None  # noqa: S101 (paid plans have a period)
        return plan.period_days

    def _plan_name(self, plan_id: str) -> str:
        plan = self.plans.get(plan_id)
        return plan.name if plan else plan_id

    def _period(self, period: Subscription) -> PeriodRead:
        return PeriodRead(
            plan_id=period.plan_id,  # type: ignore[arg-type]
            plan_name=self._plan_name(period.plan_id),
            starts_at=period.starts_at,
            ends_at=period.ends_at,
        )

    def _payment(self, payment: Payment) -> PaymentRead:
        return PaymentRead(
            id=payment.id,
            plan_id=payment.plan_id,  # type: ignore[arg-type]
            plan_name=self._plan_name(payment.plan_id),
            amount_paise=payment.amount_paise,
            currency=payment.currency,  # type: ignore[arg-type]
            status=payment.status,  # type: ignore[arg-type]
            method=payment.method,
            created_at=payment.created_at,
            paid_at=payment.paid_at,
        )


NOTHING_CHARGED = "Nothing was charged."
# After Checkout reported success, money may have moved even though Thread can't confirm it.
CONFIRM_LATER = (
    "If you were charged, your plan starts as soon as Razorpay confirms the payment to Thread."
)


def _unreachable(after: str = NOTHING_CHARGED) -> BillingUnavailable:
    return BillingUnavailable(
        "payments_unavailable", f"Razorpay can't be reached right now. {after}"
    )


def _provider_failed(after: str = NOTHING_CHARGED) -> BillingRefused:
    return BillingRefused(
        "payment_provider_error", f"Razorpay gave an answer Thread couldn't use. {after}", 502
    )
