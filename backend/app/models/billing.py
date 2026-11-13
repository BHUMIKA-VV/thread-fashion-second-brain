"""Payments, the access periods they buy, and webhook events (M14).

Billing model: one payment buys one period of a paid plan (30 days by default); nothing
renews or charges by itself. Paying again adds the next period after the current one ends.
An account with no current period is on Free.

The database itself guarantees the rules that matter most:

- an access period always comes from exactly one payment, by the same account, for the same
  plan (a composite foreign key and a unique payment_id), so access can't exist unpaid;
- one account never has two active periods that overlap (an exclusion constraint);
- amounts are whole paise in INR, and each status carries the timestamps it implies.

Only what billing needs is kept: Razorpay's order and payment ids, the amount, the plan, the
kind of payment method and a short failure code. Never card numbers, UPI IDs, bank details,
or the payer's email or phone. Payments outlive a deleted account (user_id becomes NULL), so
the record of money taken is never silently lost; access periods go with the account.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ExcludeConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.models.enums import (
    BillingEventOutcome,
    BillingProvider,
    CancelReason,
    PaidPlan,
    PaymentMethod,
    PaymentStatus,
    SubscriptionStatus,
    sql_in,
)

SETTLED = "status IN ('paid', 'refunded')"


class Payment(TimestampMixin, Base):
    """One order with the provider, and what became of it. Plan, amount and period are copied
    from the catalogue when the order is made, so history stays true if prices change."""

    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint(f"provider IN ({sql_in(BillingProvider)})", name="provider"),
        CheckConstraint(f"plan_id IN ({sql_in(PaidPlan)})", name="plan_id"),
        CheckConstraint(f"status IN ({sql_in(PaymentStatus)})", name="status"),
        CheckConstraint(f"method IS NULL OR method IN ({sql_in(PaymentMethod)})", name="method"),
        CheckConstraint("amount_paise > 0", name="positive_amount"),
        CheckConstraint("currency = 'INR'", name="currency"),
        CheckConstraint("period_days BETWEEN 1 AND 366", name="period_days"),
        CheckConstraint("refunded_paise BETWEEN 0 AND amount_paise", name="refund_within_amount"),
        # A settled payment was verified: it has the provider's payment id and a paid time.
        CheckConstraint(f"(paid_at IS NOT NULL) = ({SETTLED})", name="paid_at"),
        CheckConstraint(f"NOT ({SETTLED}) OR provider_payment_id IS NOT NULL", name="paid_id"),
        CheckConstraint("(failed_at IS NOT NULL) = (status = 'failed')", name="failed_at"),
        # Refunded means refunded in full; a partial refund leaves the payment paid.
        CheckConstraint(
            "(status = 'refunded') = (refunded_paise > 0 AND refunded_paise = amount_paise)",
            name="full_refund",
        ),
        CheckConstraint(f"refunded_paise = 0 OR {SETTLED}", name="refund_only_when_paid"),
        CheckConstraint("(refunded_at IS NOT NULL) = (refunded_paise > 0)", name="refunded_at"),
        UniqueConstraint("provider_order_id"),
        UniqueConstraint("provider_payment_id"),
        # Target for the composite foreign key on subscriptions.
        UniqueConstraint("id", "user_id", "plan_id"),
        Index("ix_payments_user_id_created_at", "user_id", text("created_at DESC")),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    # NULL once the account is deleted: the payment record itself is kept.
    user_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    provider: Mapped[str] = mapped_column(String(20))
    provider_order_id: Mapped[str] = mapped_column(String(64))
    provider_payment_id: Mapped[str | None] = mapped_column(String(64))
    plan_id: Mapped[str] = mapped_column(String(20))
    amount_paise: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3))
    period_days: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20))
    method: Mapped[str | None] = mapped_column(String(20))
    refunded_paise: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    # The provider's short error code only, never its free-text description.
    failure_code: Mapped[str | None] = mapped_column(String(64))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Subscription(TimestampMixin, Base):
    """One paid period of access to a plan, from starts_at up to (not including) ends_at.

    Current when active and starts_at <= now < ends_at; there is no stored "expired". A
    renewal is a new row that starts when the previous one ends. Cancelling ends it early
    (after a refund, or by the owner); the row is kept.
    """

    __tablename__ = "subscriptions"
    __table_args__ = (
        CheckConstraint(f"plan_id IN ({sql_in(PaidPlan)})", name="plan_id"),
        CheckConstraint(f"status IN ({sql_in(SubscriptionStatus)})", name="status"),
        CheckConstraint(
            f"cancel_reason IS NULL OR cancel_reason IN ({sql_in(CancelReason)})",
            name="cancel_reason",
        ),
        CheckConstraint("ends_at > starts_at", name="ends_after_start"),
        CheckConstraint("(status = 'cancelled') = (cancelled_at IS NOT NULL)", name="cancelled"),
        CheckConstraint(
            "(status = 'cancelled') = (cancel_reason IS NOT NULL)", name="cancel_has_reason"
        ),
        # The period was bought by this account, for this plan: no one else's payment, and no
        # Studio payment granting Studio Pro. The restrict keeps a payment from being deleted
        # while it still grants a period.
        ForeignKeyConstraint(
            ["payment_id", "user_id", "plan_id"],
            ["payments.id", "payments.user_id", "payments.plan_id"],
            ondelete="RESTRICT",
            name="fk_subscriptions_payment",
        ),
        UniqueConstraint("payment_id"),
        # Never two active periods of one account at the same time.
        ExcludeConstraint(
            ("user_id", "="),
            (text("tstzrange(starts_at, ends_at)"), "&&"),
            using="gist",
            where=text("status = 'active'"),
            name="ex_subscriptions_no_overlap",
        ),
        Index("ix_subscriptions_user_id_ends_at", "user_id", text("ends_at DESC")),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    payment_id: Mapped[UUID] = mapped_column()
    plan_id: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_reason: Mapped[str | None] = mapped_column(String(20))


class BillingEvent(Base):
    """A webhook event already handled, so a repeat delivery is recognised and skipped.
    The event's body is never stored: only its id, type, time and what Thread did with it."""

    __tablename__ = "billing_events"
    __table_args__ = (
        CheckConstraint(f"provider IN ({sql_in(BillingProvider)})", name="provider"),
        CheckConstraint(f"outcome IN ({sql_in(BillingEventOutcome)})", name="outcome"),
        UniqueConstraint("provider", "event_id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    provider: Mapped[str] = mapped_column(String(20))
    event_id: Mapped[str] = mapped_column(String(64))
    event_type: Mapped[str] = mapped_column(String(64))
    # The provider's own time for the event, to put deliveries that arrive late in order.
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    payment_id: Mapped[UUID | None] = mapped_column(ForeignKey("payments.id", ondelete="SET NULL"))
    outcome: Mapped[str] = mapped_column(String(20))
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
