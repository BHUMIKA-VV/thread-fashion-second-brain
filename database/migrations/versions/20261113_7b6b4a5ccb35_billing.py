"""billing: payments, paid access periods and webhook events

Adds three tables and touches no existing table or row: an account with no access period is
on Free, as every account is today. Enables btree_gist (shipped with PostgreSQL) for the
constraint that keeps one account from holding two overlapping active periods.

Downgrade drops the three tables, which DELETES ALL BILLING HISTORY. Never run it against a
database that holds real payments. btree_gist is left installed: something else may use it.

Revision ID: 7b6b4a5ccb35
Revises: e3b7d9a1c4f2
Create Date: 2026-11-13 12:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "7b6b4a5ccb35"
down_revision: str | None = "e3b7d9a1c4f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PLANS = "'studio', 'studio_pro'"
SETTLED = "status IN ('paid', 'refunded')"


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    ]


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")

    op.create_table(
        "payments",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("provider_order_id", sa.String(length=64), nullable=False),
        sa.Column("provider_payment_id", sa.String(length=64), nullable=True),
        sa.Column("plan_id", sa.String(length=20), nullable=False),
        sa.Column("amount_paise", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("period_days", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("method", sa.String(length=20), nullable=True),
        sa.Column("refunded_paise", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("failure_code", sa.String(length=64), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.CheckConstraint("provider IN ('razorpay')", name=op.f("ck_payments_provider")),
        sa.CheckConstraint(f"plan_id IN ({PLANS})", name=op.f("ck_payments_plan_id")),
        sa.CheckConstraint(
            "status IN ('created', 'paid', 'failed', 'refunded')", name=op.f("ck_payments_status")
        ),
        sa.CheckConstraint(
            "method IS NULL OR method IN ('card', 'upi', 'netbanking', 'wallet', 'other')",
            name=op.f("ck_payments_method"),
        ),
        sa.CheckConstraint("amount_paise > 0", name=op.f("ck_payments_positive_amount")),
        sa.CheckConstraint("currency = 'INR'", name=op.f("ck_payments_currency")),
        sa.CheckConstraint("period_days BETWEEN 1 AND 366", name=op.f("ck_payments_period_days")),
        sa.CheckConstraint(
            "refunded_paise BETWEEN 0 AND amount_paise",
            name=op.f("ck_payments_refund_within_amount"),
        ),
        sa.CheckConstraint(
            f"(paid_at IS NOT NULL) = ({SETTLED})", name=op.f("ck_payments_paid_at")
        ),
        sa.CheckConstraint(
            f"NOT ({SETTLED}) OR provider_payment_id IS NOT NULL", name=op.f("ck_payments_paid_id")
        ),
        sa.CheckConstraint(
            "(failed_at IS NOT NULL) = (status = 'failed')", name=op.f("ck_payments_failed_at")
        ),
        sa.CheckConstraint(
            "(status = 'refunded') = (refunded_paise > 0 AND refunded_paise = amount_paise)",
            name=op.f("ck_payments_full_refund"),
        ),
        sa.CheckConstraint(
            f"refunded_paise = 0 OR {SETTLED}", name=op.f("ck_payments_refund_only_when_paid")
        ),
        sa.CheckConstraint(
            "(refunded_at IS NOT NULL) = (refunded_paise > 0)", name=op.f("ck_payments_refunded_at")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_payments_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_payments")),
        sa.UniqueConstraint("provider_order_id", name=op.f("uq_payments_provider_order_id")),
        sa.UniqueConstraint("provider_payment_id", name=op.f("uq_payments_provider_payment_id")),
        sa.UniqueConstraint(
            "id", "user_id", "plan_id", name=op.f("uq_payments_id_user_id_plan_id")
        ),
    )
    op.create_index(
        "ix_payments_user_id_created_at",
        "payments",
        ["user_id", sa.text("created_at DESC")],
        unique=False,
    )

    op.create_table(
        "subscriptions",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("payment_id", sa.Uuid(), nullable=False),
        sa.Column("plan_id", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancel_reason", sa.String(length=20), nullable=True),
        *_timestamps(),
        sa.CheckConstraint(f"plan_id IN ({PLANS})", name=op.f("ck_subscriptions_plan_id")),
        sa.CheckConstraint(
            "status IN ('active', 'cancelled')", name=op.f("ck_subscriptions_status")
        ),
        sa.CheckConstraint(
            "cancel_reason IS NULL OR cancel_reason IN ('refund', 'owner')",
            name=op.f("ck_subscriptions_cancel_reason"),
        ),
        sa.CheckConstraint("ends_at > starts_at", name=op.f("ck_subscriptions_ends_after_start")),
        sa.CheckConstraint(
            "(status = 'cancelled') = (cancelled_at IS NOT NULL)",
            name=op.f("ck_subscriptions_cancelled"),
        ),
        sa.CheckConstraint(
            "(status = 'cancelled') = (cancel_reason IS NOT NULL)",
            name=op.f("ck_subscriptions_cancel_has_reason"),
        ),
        sa.ForeignKeyConstraint(
            ["payment_id", "user_id", "plan_id"],
            ["payments.id", "payments.user_id", "payments.plan_id"],
            name="fk_subscriptions_payment",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_subscriptions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_subscriptions")),
        sa.UniqueConstraint("payment_id", name=op.f("uq_subscriptions_payment_id")),
        postgresql.ExcludeConstraint(
            ("user_id", "="),
            (sa.text("tstzrange(starts_at, ends_at)"), "&&"),
            using="gist",
            where=sa.text("status = 'active'"),
            name="ex_subscriptions_no_overlap",
        ),
    )
    op.create_index(
        "ix_subscriptions_user_id_ends_at",
        "subscriptions",
        ["user_id", sa.text("ends_at DESC")],
        unique=False,
    )

    op.create_table(
        "billing_events",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("event_id", sa.String(length=64), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payment_id", sa.Uuid(), nullable=True),
        sa.Column("outcome", sa.String(length=20), nullable=False),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("provider IN ('razorpay')", name=op.f("ck_billing_events_provider")),
        sa.CheckConstraint(
            "outcome IN ('applied', 'ignored', 'stale')", name=op.f("ck_billing_events_outcome")
        ),
        sa.ForeignKeyConstraint(
            ["payment_id"],
            ["payments.id"],
            name=op.f("fk_billing_events_payment_id_payments"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_billing_events")),
        sa.UniqueConstraint(
            "provider", "event_id", name=op.f("uq_billing_events_provider_event_id")
        ),
    )


def downgrade() -> None:
    # Deletes all billing history (see the module docstring). btree_gist stays installed.
    op.drop_table("billing_events")
    op.drop_index("ix_subscriptions_user_id_ends_at", table_name="subscriptions")
    op.drop_table("subscriptions")
    op.drop_index("ix_payments_user_id_created_at", table_name="payments")
    op.drop_table("payments")
