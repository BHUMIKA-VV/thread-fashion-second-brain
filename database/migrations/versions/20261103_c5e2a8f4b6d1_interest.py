"""interest: early access and studio pilot interest from the public site

Adds one table, unrelated to accounts. No existing rows change on upgrade; downgrade drops the
table and the interest it holds.

Revision ID: c5e2a8f4b6d1
Revises: b8e4c1f7a2d9
Create Date: 2026-11-03 14:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c5e2a8f4b6d1"
down_revision: str | None = "b8e4c1f7a2d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

KINDS = "'wardrobe', 'studio'"
ROLES = "'stylist', 'designer', 'boutique', 'textile_researcher', 'collector', 'student', 'other'"


def upgrade() -> None:
    op.create_table(
        "interest",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("role", sa.String(length=30), nullable=True),
        sa.Column("name", sa.String(length=120), nullable=True),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("consented_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("contacted_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.CheckConstraint(f"kind IN ({KINDS})", name=op.f("ck_interest_kind")),
        sa.CheckConstraint(f"role IS NULL OR role IN ({ROLES})", name=op.f("ck_interest_role")),
        sa.CheckConstraint(
            "(kind = 'studio') = (role IS NOT NULL)", name=op.f("ck_interest_role_for_studio")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_interest")),
    )
    op.create_index(
        "uq_interest_lower_email_kind", "interest", [sa.text("lower(email)"), "kind"], unique=True
    )


def downgrade() -> None:
    op.drop_index("uq_interest_lower_email_kind", table_name="interest")
    op.drop_table("interest")
