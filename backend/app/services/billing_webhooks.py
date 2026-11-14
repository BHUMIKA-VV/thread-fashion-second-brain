"""Razorpay webhooks: what Razorpay tells Thread about payments after the browser is gone.

Verify (app/services/billing.py) settles a payment while the buyer waits. Webhooks settle the
rest: a payment whose tab was closed, an authorisation captured later, a failure, a refund.
Both go through the same settle code, so a payment is settled once whichever arrives first.

Razorpay delivers at least once, retries for 24 hours until it gets a 2xx within 5 seconds,
and doesn't keep events in order. So:

- every event is recorded by its x-razorpay-event-id in the same transaction as its effect;
  a repeat is recognised and skipped, and a crash rolls both back so the retry redoes it;
- statuses only move forward: a paid payment never becomes unpaid or failed again, and the
  refunded amount only grows. An event that would move one back is recorded as "stale";
- the amounts in the event must match the order Thread stored, as with verify.

The event body itself is never stored (only its id, type, time and outcome).
"""

import logging
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.billing.razorpay import ProviderPayment, WebhookEvent
from app.models import BillingEvent, Payment
from app.models.enums import BillingEventOutcome, BillingProvider, PaymentStatus
from app.services.billing import BillingService

logger = logging.getLogger(__name__)

APPLIED = BillingEventOutcome.APPLIED.value
IGNORED = BillingEventOutcome.IGNORED.value
STALE = BillingEventOutcome.STALE.value
SETTLED = (PaymentStatus.PAID.value, PaymentStatus.REFUNDED.value)
UNSETTLED = (PaymentStatus.CREATED.value, PaymentStatus.FAILED.value)
PROVIDER = BillingProvider.RAZORPAY.value

Outcome = Literal["applied", "ignored", "stale", "duplicate"]


@dataclass(frozen=True)
class Handled:
    outcome: Outcome


class WebhookService:
    def __init__(self, db: Session, billing: BillingService) -> None:
        self.db = db
        self.billing = billing

    def handle(self, event_id: str, event: WebhookEvent) -> Handled:
        if self._seen(event_id):
            return Handled("duplicate")
        payment, outcome = self._apply(event)
        self.db.add(
            BillingEvent(
                provider=PROVIDER,
                event_id=event_id,
                event_type=event.type,
                occurred_at=event.occurred_at,
                payment_id=payment.id if payment else None,
                outcome=outcome,
            )
        )
        try:
            self.db.commit()
        except IntegrityError:
            # The same event, delivered twice at once: the other delivery recorded it first
            # (and its effect, which this one's rollback leaves alone).
            self.db.rollback()
            if self._seen(event_id):
                return Handled("duplicate")
            raise
        logger.info("Webhook %s (%s): %s", event_id, event.type, outcome)
        return Handled(outcome)  # type: ignore[arg-type]

    def _seen(self, event_id: str) -> bool:
        return (
            self.db.scalar(
                select(BillingEvent.id).where(
                    BillingEvent.provider == PROVIDER, BillingEvent.event_id == event_id
                )
            )
            is not None
        )

    def _apply(self, event: WebhookEvent) -> tuple[Payment | None, str]:
        remote = event.payment
        if remote is None:
            return None, IGNORED
        payment = self._payment_for(remote)
        if payment is None:
            # Not one of Thread's orders (the Razorpay account may serve something else too).
            return None, IGNORED
        if event.type in ("payment.captured", "order.paid"):
            return payment, self._captured(payment, remote)
        if event.type == "payment.failed":
            return payment, self._failed(payment, remote)
        if event.type == "refund.processed":
            return payment, self._refunded(payment, remote)
        # payment.authorized grants nothing; refund.created and refund.failed move no money.
        return payment, IGNORED

    def _payment_for(self, remote: ProviderPayment) -> Payment | None:
        return self.db.scalar(
            select(Payment)
            .where(Payment.provider == PROVIDER, Payment.provider_order_id == remote.order_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    def _captured(self, payment: Payment, remote: ProviderPayment) -> str:
        if payment.status in SETTLED:
            return IGNORED  # verify (or an earlier event) got there first
        if remote.status != "captured" or not self.billing.matches(payment, remote):
            return IGNORED
        self.billing.settle(payment, remote)
        return APPLIED

    def _failed(self, payment: Payment, remote: ProviderPayment) -> str:
        if payment.status in SETTLED:
            return STALE  # a failed attempt reported after a successful one
        if payment.status == PaymentStatus.FAILED.value:
            return IGNORED
        if remote.status != "failed" or not self.billing.matches(payment, remote):
            return IGNORED
        self.billing.settle(payment, remote)
        return APPLIED

    def _refunded(self, payment: Payment, remote: ProviderPayment) -> str:
        if payment.status in UNSETTLED:
            # Thread never saw this payment captured, so it granted nothing to take back. An
            # authorisation Razorpay refunds automatically arrives like this.
            return IGNORED
        if payment.provider_payment_id != remote.id or not self.billing.matches(payment, remote):
            return IGNORED
        return APPLIED if self.billing.record_refund(payment, remote.refunded_paise) else STALE
