"""boards: moodboards and their blocks

Adds two tables and touches no existing data. Composite foreign keys make it impossible, in
the database, to put another owner's piece on a board. Downgrade drops both tables, which
deletes saved boards; pieces are left as they are.

Revision ID: e3b7d9a1c4f2
Revises: d8a4f6b2c9e7
Create Date: 2026-11-04 12:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e3b7d9a1c4f2"
down_revision: str | None = "d8a4f6b2c9e7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
    )


def upgrade() -> None:
    op.create_table(
        "boards",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        _created_at(),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("char_length(btrim(name)) > 0", name=op.f("ck_boards_name_not_blank")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_boards_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_boards")),
        sa.UniqueConstraint("id", "user_id", name=op.f("uq_boards_id_user_id")),
    )
    op.create_index(
        "ix_boards_user_id_updated_at",
        "boards",
        ["user_id", sa.text("updated_at DESC")],
        unique=False,
    )
    op.create_table(
        "board_blocks",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("board_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("item_id", sa.Uuid(), nullable=True),
        sa.Column("hex", sa.String(length=7), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        _created_at(),
        sa.CheckConstraint("position >= 0", name=op.f("ck_board_blocks_non_negative_position")),
        sa.CheckConstraint(
            "kind IN ('piece', 'colour', 'heading', 'note')", name=op.f("ck_board_blocks_kind")
        ),
        sa.CheckConstraint(
            "(kind = 'piece') = (item_id IS NOT NULL)", name=op.f("ck_board_blocks_piece_has_item")
        ),
        sa.CheckConstraint(
            "(kind = 'colour') = (hex IS NOT NULL)", name=op.f("ck_board_blocks_colour_has_hex")
        ),
        sa.CheckConstraint(
            "hex IS NULL OR hex ~ '^#[0-9a-f]{6}$'", name=op.f("ck_board_blocks_hex_format")
        ),
        sa.CheckConstraint(
            "kind NOT IN ('heading', 'note') OR char_length(btrim(body)) > 0",
            name=op.f("ck_board_blocks_body_not_blank"),
        ),
        sa.CheckConstraint("char_length(body) <= 2000", name=op.f("ck_board_blocks_body_length")),
        sa.ForeignKeyConstraint(
            ["board_id", "user_id"],
            ["boards.id", "boards.user_id"],
            name="fk_board_blocks_board_owner",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["item_id", "user_id"],
            ["items.id", "items.user_id"],
            name="fk_board_blocks_item_owner",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_board_blocks")),
    )
    op.create_index(
        "ix_board_blocks_board_id_position",
        "board_blocks",
        ["board_id", "position"],
        unique=False,
    )
    op.create_index("ix_board_blocks_item_id", "board_blocks", ["item_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_board_blocks_item_id", table_name="board_blocks")
    op.drop_index("ix_board_blocks_board_id_position", table_name="board_blocks")
    op.drop_table("board_blocks")
    op.drop_index("ix_boards_user_id_updated_at", table_name="boards")
    op.drop_table("boards")
