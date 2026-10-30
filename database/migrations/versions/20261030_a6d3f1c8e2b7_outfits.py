"""outfits: outfits, outfit_items and collection_outfits

Adds three tables and touches no existing data. Composite foreign keys make it impossible, in
the database, to link an outfit to another owner's piece or collection. Downgrade drops the
three tables, which deletes saved outfits; pieces and collections are left as they are.

Revision ID: a6d3f1c8e2b7
Revises: f2c9a7e5b1d4
Create Date: 2026-10-30 18:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a6d3f1c8e2b7"
down_revision: str | None = "f2c9a7e5b1d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
    )


def upgrade() -> None:
    op.create_table(
        "outfits",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("occasion", sa.String(length=80), nullable=True),
        sa.Column("season", sa.String(length=20), nullable=True),
        sa.Column(
            "style_tags",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'::text[]"),
            nullable=False,
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("layout", sa.String(length=20), server_default="feature", nullable=False),
        _created_at(),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("char_length(btrim(name)) > 0", name=op.f("ck_outfits_name_not_blank")),
        sa.CheckConstraint(
            "layout IN ('feature', 'grid', 'column')", name=op.f("ck_outfits_layout")
        ),
        sa.CheckConstraint(
            "season IS NULL OR season IN"
            " ('spring', 'summer', 'monsoon', 'autumn', 'winter', 'all_season')",
            name=op.f("ck_outfits_season"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_outfits_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_outfits")),
        sa.UniqueConstraint("id", "user_id", name=op.f("uq_outfits_id_user_id")),
    )
    op.create_index(
        "ix_outfits_user_id_updated_at",
        "outfits",
        ["user_id", sa.text("updated_at DESC")],
        unique=False,
    )
    op.create_table(
        "outfit_items",
        sa.Column("outfit_id", sa.Uuid(), nullable=False),
        sa.Column("item_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=20), server_default="piece", nullable=False),
        _created_at(),
        sa.CheckConstraint("position >= 0", name=op.f("ck_outfit_items_non_negative_position")),
        sa.CheckConstraint(
            "role IN ('piece', 'accessory', 'inspiration')", name=op.f("ck_outfit_items_role")
        ),
        sa.ForeignKeyConstraint(
            ["item_id", "user_id"],
            ["items.id", "items.user_id"],
            name="fk_outfit_items_item_owner",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["outfit_id", "user_id"],
            ["outfits.id", "outfits.user_id"],
            name="fk_outfit_items_outfit_owner",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("outfit_id", "item_id", name=op.f("pk_outfit_items")),
        sa.UniqueConstraint(
            "outfit_id", "position", name=op.f("uq_outfit_items_outfit_id_position")
        ),
    )
    op.create_index("ix_outfit_items_item_id", "outfit_items", ["item_id"], unique=False)
    op.create_table(
        "collection_outfits",
        sa.Column("collection_id", sa.Uuid(), nullable=False),
        sa.Column("outfit_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        _created_at(),
        sa.ForeignKeyConstraint(
            ["collection_id", "user_id"],
            ["collections.id", "collections.user_id"],
            name="fk_collection_outfits_collection_owner",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["outfit_id", "user_id"],
            ["outfits.id", "outfits.user_id"],
            name="fk_collection_outfits_outfit_owner",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("collection_id", "outfit_id", name=op.f("pk_collection_outfits")),
    )
    op.create_index(
        "ix_collection_outfits_outfit_id", "collection_outfits", ["outfit_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_collection_outfits_outfit_id", table_name="collection_outfits")
    op.drop_table("collection_outfits")
    op.drop_index("ix_outfit_items_item_id", table_name="outfit_items")
    op.drop_table("outfit_items")
    op.drop_index("ix_outfits_user_id_updated_at", table_name="outfits")
    op.drop_table("outfits")
