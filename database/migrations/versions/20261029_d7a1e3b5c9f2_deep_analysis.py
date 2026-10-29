"""deep analysis: deep_analyses (latest attempt + last result per item) and daily usage

Adds two tables and touches no existing data. Downgrade drops them, which deletes stored
deep-analysis results; items.ai_description (from the initial schema) is left as it is.

Revision ID: d7a1e3b5c9f2
Revises: c3d1f2a7e9b4
Create Date: 2026-10-29 12:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d7a1e3b5c9f2"
down_revision: str | None = "c3d1f2a7e9b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "deep_analyses",
        sa.Column("item_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("requested_model", sa.String(length=100), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_code", sa.String(length=40), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("retry_after_seconds", sa.Integer(), nullable=True),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("result_model", sa.String(length=100), nullable=True),
        sa.Column("result_prompt_version", sa.String(length=20), nullable=True),
        sa.Column("result_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
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
        sa.CheckConstraint(
            "status IN ('running', 'completed', 'failed')", name=op.f("ck_deep_analyses_status")
        ),
        sa.CheckConstraint(
            "input_tokens IS NULL OR input_tokens >= 0", name=op.f("ck_deep_analyses_input_tokens")
        ),
        sa.CheckConstraint(
            "output_tokens IS NULL OR output_tokens >= 0",
            name=op.f("ck_deep_analyses_output_tokens"),
        ),
        sa.ForeignKeyConstraint(
            ["item_id", "user_id"],
            ["items.id", "items.user_id"],
            name="fk_deep_analyses_item_owner",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("item_id", name=op.f("pk_deep_analyses")),
    )
    op.create_index(
        "ix_deep_analyses_running_started_at",
        "deep_analyses",
        ["started_at"],
        unique=False,
        postgresql_where=sa.text("status = 'running'"),
    )
    op.create_table(
        "deep_analysis_usage",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("runs", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.CheckConstraint("runs >= 0", name=op.f("ck_deep_analysis_usage_runs")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_deep_analysis_usage_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "day", name=op.f("pk_deep_analysis_usage")),
    )


def downgrade() -> None:
    op.drop_table("deep_analysis_usage")
    op.drop_index(
        "ix_deep_analyses_running_started_at",
        table_name="deep_analyses",
        postgresql_where=sa.text("status = 'running'"),
    )
    op.drop_table("deep_analyses")
