from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAtMixin, TimestampMixin
from app.models.enums import BoardBlockKind, sql_in

if TYPE_CHECKING:
    from app.models.item import Item


class Board(TimestampMixin, Base):
    """A moodboard for a client or a concept: pieces, colours and notes in order. Private."""

    __tablename__ = "boards"
    __table_args__ = (
        CheckConstraint("char_length(btrim(name)) > 0", name="name_not_blank"),
        # Target for the composite foreign key on board_blocks.
        UniqueConstraint("id", "user_id"),
        Index("ix_boards_user_id_updated_at", "user_id", text("updated_at DESC")),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)


class BoardBlock(CreatedAtMixin, Base):
    """One block on a board. Its kind decides which of item_id, hex and body it carries:
    a piece has item_id (and may have a caption in body), a colour has hex (and may have a
    caption), a heading or a note has body text. The database enforces this shape.

    user_id is stored so two composite foreign keys can guarantee, in the database itself,
    that the board and the piece belong to the same owner. Deleting a piece removes only its
    blocks; the board keeps the rest.
    """

    __tablename__ = "board_blocks"
    __table_args__ = (
        ForeignKeyConstraint(
            ["board_id", "user_id"],
            ["boards.id", "boards.user_id"],
            ondelete="CASCADE",
            name="fk_board_blocks_board_owner",
        ),
        ForeignKeyConstraint(
            ["item_id", "user_id"],
            ["items.id", "items.user_id"],
            ondelete="CASCADE",
            name="fk_board_blocks_item_owner",
        ),
        CheckConstraint("position >= 0", name="non_negative_position"),
        CheckConstraint(f"kind IN ({sql_in(BoardBlockKind)})", name="kind"),
        CheckConstraint("(kind = 'piece') = (item_id IS NOT NULL)", name="piece_has_item"),
        CheckConstraint("(kind = 'colour') = (hex IS NOT NULL)", name="colour_has_hex"),
        CheckConstraint("hex IS NULL OR hex ~ '^#[0-9a-f]{6}$'", name="hex_format"),
        CheckConstraint(
            "kind NOT IN ('heading', 'note') OR char_length(btrim(body)) > 0",
            name="body_not_blank",
        ),
        CheckConstraint("char_length(body) <= 2000", name="body_length"),
        Index("ix_board_blocks_board_id_position", "board_id", "position"),
        Index("ix_board_blocks_item_id", "item_id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    board_id: Mapped[UUID] = mapped_column()
    user_id: Mapped[UUID] = mapped_column()
    position: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(20))
    item_id: Mapped[UUID | None] = mapped_column()
    hex: Mapped[str | None] = mapped_column(String(7))
    body: Mapped[str | None] = mapped_column(Text)

    item: Mapped["Item | None"] = relationship(
        primaryjoin="BoardBlock.item_id == Item.id", foreign_keys=[item_id], viewonly=True
    )
