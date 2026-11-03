"""metric_counts: anonymous visit counts per day, page and source

Adds one table of plain numbers, unrelated to accounts. No existing rows change on upgrade;
downgrade drops the table and its counts.

Revision ID: d8a4f6b2c9e7
Revises: c5e2a8f4b6d1
Create Date: 2026-11-03 18:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d8a4f6b2c9e7"
down_revision: str | None = "c5e2a8f4b6d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "metric_counts",
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("event", sa.String(length=40), nullable=False),
        sa.Column("source", sa.String(length=40), nullable=False),
        sa.Column("count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.CheckConstraint("event ~ '^[a-z_]{1,40}$'", name=op.f("ck_metric_counts_event")),
        sa.CheckConstraint(
            "source ~ '^(ref:)?[a-z0-9-]{1,32}$'", name=op.f("ck_metric_counts_source")
        ),
        sa.CheckConstraint("count >= 0", name=op.f("ck_metric_counts_count")),
        sa.PrimaryKeyConstraint("day", "event", "source", name=op.f("pk_metric_counts")),
    )


def downgrade() -> None:
    op.drop_table("metric_counts")
