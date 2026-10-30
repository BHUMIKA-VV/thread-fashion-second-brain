"""showcase: is_public on items and collections

Adds a boolean that defaults to false, so every existing piece and collection stays private
until the owner publishes it, plus a partial index for the showcase's reads. Downgrade drops
both columns, which simply unpublishes everything; no piece or collection is touched.

Revision ID: f2c9a7e5b1d4
Revises: e4b8c2d6f1a3
Create Date: 2026-10-30 10:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f2c9a7e5b1d4"
down_revision: str | None = "e4b8c2d6f1a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "items",
        sa.Column("is_public", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "collections",
        sa.Column("is_public", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.create_index(
        "ix_items_public_created_at",
        "items",
        ["user_id", sa.text("created_at DESC")],
        unique=False,
        postgresql_where=sa.text("is_public"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_items_public_created_at", table_name="items", postgresql_where=sa.text("is_public")
    )
    op.drop_column("collections", "is_public")
    op.drop_column("items", "is_public")
