"""The owner's view of billing (M14-7): figures, lookup, one account's billing, and one
support action. Every route that uses this is owner-only (api/deps.py: Owner).

Read-only, except "check with Razorpay": the same check an account holder can run on their
own unfinished payment or refund in progress. It brings Thread's record up to date with what
Razorpay says and can't move money, grant access or change an amount. The owner can't refund,
cancel or grant a period from here: refunds wait for a published refund policy, and access
only ever comes from a verified payment.

Lookups and checks are recorded in admin_actions, with ids and a short outcome only.
"""

from collections.abc import Callable
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import ColumnElement, and_, func, select
from sqlalchemy.orm import Session

from app.billing.plans import PlanId
from app.billing.razorpay import PaymentProvider
from app.core.config import Settings
from app.models import AdminAction, Payment, Subscription, User
from app.models.enums import AdminActionKind, CancelReason, PaymentStatus, SubscriptionStatus
from app.schemas.admin import (
    AccountsByPlan,
    AdminActionRead,
    BillingSummary,
    BillingTotals,
    PaymentsByStatus,
)
from app.schemas.billing import BillingAccount, PaymentPage, PaymentRead
from app.services.auth import AuthRefused, Principal, to_principal
from app.services.billing import BillingRefused, BillingService, BillingUnavailable

RECENT_ACTIONS = 20
ACTIVE = SubscriptionStatus.ACTIVE.value
CANCELLED = SubscriptionStatus.CANCELLED.value
SETTLED = (PaymentStatus.PAID.value, PaymentStatus.REFUNDED.value)
NO_MATCH = AuthRefused("not_found", "No account or payment matches that.", 404)
NO_ACCOUNT = AuthRefused("not_found", "No such account.", 404)


def _now() -> datetime:
    return datetime.now(UTC)


def record(
    db: Session,
    actor: Principal,
    action: AdminActionKind,
    outcome: str,
    *,
    account_id: UUID | None = None,
    payment_id: UUID | None = None,
) -> None:
    """Add one row to the owner's action record and commit it."""
    db.add(
        AdminAction(
            actor_id=actor.id,
            action=action.value,
            account_id=account_id,
            payment_id=payment_id,
            outcome=outcome,
        )
    )
    db.commit()


class AdminBilling:
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

    def _billing(self) -> BillingService:
        return BillingService(self.db, self.settings, self.provider, self.clock)

    # --- figures -----------------------------------------------------------------------------

    def summary(self) -> BillingSummary:
        now = self.clock()
        current = self._current_condition(now)
        on_plan = dict(
            self.db.execute(
                select(Subscription.plan_id, func.count(func.distinct(Subscription.user_id)))
                .where(current)
                .group_by(Subscription.plan_id)
            ).all()
        )
        customers = self.db.scalar(select(func.count()).where(User.is_owner.is_(False))) or 0
        paid_ahead = self.db.scalar(
            select(func.count()).where(Subscription.status == ACTIVE, Subscription.starts_at > now)
        )
        still_active = select(Subscription.user_id).where(
            Subscription.status == ACTIVE, Subscription.ends_at > now
        )
        ended = self.db.scalar(
            select(func.count(func.distinct(Subscription.user_id))).where(
                Subscription.user_id.not_in(still_active)
            )
        )
        cancelled = dict(
            self.db.execute(
                select(Subscription.cancel_reason, func.count())
                .where(Subscription.status == CANCELLED)
                .group_by(Subscription.cancel_reason)
            ).all()
        )
        by_status = dict(
            self.db.execute(select(Payment.status, func.count()).group_by(Payment.status)).all()
        )
        # Paid, nothing refunded yet, and its period cancelled for a refund: Razorpay is on it.
        refund_requested = self.db.scalar(
            select(func.count())
            .select_from(Payment)
            .join(Subscription, Subscription.payment_id == Payment.id)
            .where(
                Payment.status == PaymentStatus.PAID.value,
                Payment.refunded_paise == 0,
                Subscription.status == CANCELLED,
                Subscription.cancel_reason == CancelReason.REFUND.value,
            )
        )
        paid, refunded = self.db.execute(
            select(
                func.coalesce(func.sum(Payment.amount_paise), 0),
                func.coalesce(func.sum(Payment.refunded_paise), 0),
            ).where(Payment.status.in_(SETTLED))
        ).one()
        self.db.commit()
        studio = on_plan.get(PlanId.STUDIO.value, 0)
        studio_pro = on_plan.get(PlanId.STUDIO_PRO.value, 0)
        return BillingSummary(
            accounts=AccountsByPlan(
                free=max(customers - studio - studio_pro, 0), studio=studio, studio_pro=studio_pro
            ),
            paid_ahead=paid_ahead or 0,
            ended=ended or 0,
            cancelled_refund=cancelled.get(CancelReason.REFUND.value, 0),
            cancelled_owner=cancelled.get(CancelReason.OWNER.value, 0),
            payments=PaymentsByStatus(
                unfinished=by_status.get(PaymentStatus.CREATED.value, 0),
                paid=by_status.get(PaymentStatus.PAID.value, 0),
                failed=by_status.get(PaymentStatus.FAILED.value, 0),
                refunded=by_status.get(PaymentStatus.REFUNDED.value, 0),
                refund_requested=refund_requested or 0,
            ),
            totals=BillingTotals(
                paid_paise=paid, refunded_paise=refunded, net_paise=paid - refunded
            ),
            mode=self.settings.razorpay_mode,
            provider=self.provider.name if self.provider else self.settings.payment_provider,  # type: ignore[arg-type]
        )

    def current_plans(self, user_ids: list[UUID]) -> dict[UUID, tuple[str, datetime]]:
        """Each listed account's current paid plan and when it ends; Free accounts are left out."""
        if not user_ids:
            return {}
        rows = self.db.execute(
            select(Subscription.user_id, Subscription.plan_id, Subscription.ends_at).where(
                self._current_condition(self.clock()), Subscription.user_id.in_(user_ids)
            )
        ).all()
        return {user_id: (plan_id, ends_at) for user_id, plan_id, ends_at in rows}

    # --- one account -------------------------------------------------------------------------

    def lookup(self, actor: Principal, query: str) -> UUID:
        """The account an email address, Thread payment id or Razorpay id belongs to."""
        account_id = self._find(query.strip())
        outcome = "found" if account_id else "not_found"
        record(self.db, actor, AdminActionKind.BILLING_LOOKUP, outcome, account_id=account_id)
        if account_id is None:
            raise NO_MATCH
        return account_id

    def user(self, user_id: UUID) -> User:
        user = self.db.get(User, user_id)
        if user is None:
            raise NO_ACCOUNT
        return user

    def account(self, user: User) -> BillingAccount:
        """The account's billing as its holder sees it."""
        return self._billing().account(to_principal(user))

    def payments(self, user: User, before: UUID | None, limit: int) -> PaymentPage:
        return self._billing().history(to_principal(user), before, limit)

    def check(self, actor: Principal, user_id: UUID, payment_id: UUID) -> PaymentRead:
        """Ask Razorpay again about one of this account's payments, and record the outcome."""
        user = self.user(user_id)
        kind, target = AdminActionKind.PAYMENT_CHECK, to_principal(user)
        billing = self._billing()

        def note(outcome: str, payment: UUID | None = payment_id) -> None:
            record(self.db, actor, kind, outcome, account_id=user_id, payment_id=payment)

        owned = self.db.scalar(
            select(Payment.id).where(Payment.id == payment_id, Payment.user_id == user_id)
        )
        if owned is None:
            note("not_found", payment=None)
            raise NO_MATCH
        old = self._snapshot(payment_id)
        try:
            view = billing.refresh(target, payment_id)
        except BillingUnavailable:
            self.db.rollback()
            note("unavailable")
            raise
        except BillingRefused:
            self.db.rollback()
            note("refused")
            raise
        note("no_change" if self._snapshot(payment_id) == old else "updated")
        return view

    def recent(self, limit: int = RECENT_ACTIONS) -> list[AdminActionRead]:
        rows = self.db.execute(
            select(AdminAction, User.display_name)
            .outerjoin(User, User.id == AdminAction.account_id)
            .order_by(AdminAction.created_at.desc(), AdminAction.id.desc())
            .limit(limit)
        ).all()
        self.db.commit()
        return [
            AdminActionRead(
                id=a.id,
                created_at=a.created_at,
                action=a.action,  # type: ignore[arg-type]
                account_id=a.account_id,
                account_name=name,
                payment_id=a.payment_id,
                outcome=a.outcome,
            )
            for a, name in rows
        ]

    # --- helpers -----------------------------------------------------------------------------

    @staticmethod
    def _current_condition(now: datetime) -> ColumnElement[bool]:
        return and_(
            Subscription.status == ACTIVE,
            Subscription.starts_at <= now,
            Subscription.ends_at > now,
        )

    def _snapshot(self, payment_id: UUID) -> tuple[object, ...]:
        row = self.db.execute(
            select(Payment.status, Payment.refunded_paise, Subscription.status)
            .outerjoin(Subscription, Subscription.payment_id == Payment.id)
            .where(Payment.id == payment_id)
            .execution_options(populate_existing=True)
        ).one()
        return tuple(row)

    def _find(self, query: str) -> UUID | None:
        if not query or len(query) > 254:
            return None
        if "@" in query:
            return self.db.scalar(select(User.id).where(func.lower(User.email) == query.lower()))
        if query.startswith("pay_"):
            return self.db.scalar(
                select(Payment.user_id).where(Payment.provider_payment_id == query)
            )
        if query.startswith("order_"):
            return self.db.scalar(select(Payment.user_id).where(Payment.provider_order_id == query))
        try:
            key = UUID(query)
        except ValueError:
            return None
        if self.db.get(User, key) is not None:
            return key
        return self.db.scalar(select(Payment.user_id).where(Payment.id == key))
