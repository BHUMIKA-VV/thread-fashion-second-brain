"""admin_actions: a record of what the owner did from the admin pages

Adds one table and touches no existing table or row.

Downgrade drops the table, which deletes the record of owner actions (not any billing,
account or archive data).

Revision ID: a5c2e8f1d3b9
Revises: 7b6b4a5ccb35
Create Date: 2026-11-15 10:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a5c2e8f1d3b9"
down_revision: str | None = "7b6b4a5ccb35"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ACTIONS = "'billing_lookup', 'payment_check', 'account_disable', 'account_enable'"


def upgrade() -> None:
    op.create_table(
        "admin_actions",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("clock_timestamp()"),
            nullable=False,
        ),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=True),
        sa.Column("payment_id", sa.Uuid(), nullable=True),
        sa.Column("outcome", sa.String(length=32), nullable=False),
        sa.CheckConstraint(f"action IN ({ACTIONS})", name=op.f("ck_admin_actions_action")),
        sa.ForeignKeyConstraint(
            ["actor_id"],
            ["users.id"],
            name=op.f("fk_admin_actions_actor_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["users.id"],
            name=op.f("fk_admin_actions_account_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["payment_id"],
            ["payments.id"],
            name=op.f("fk_admin_actions_payment_id_payments"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_admin_actions")),
    )
    op.create_index(
        "ix_admin_actions_created_at", "admin_actions", [sa.text("created_at DESC")], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_admin_actions_created_at", table_name="admin_actions")
    op.drop_table("admin_actions")
