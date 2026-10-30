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
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAtMixin, TimestampMixin
from app.models.enums import OutfitLayout, OutfitPieceRole, OutfitSeason, sql_in

if TYPE_CHECKING:
    from app.models.item import Item


class Outfit(TimestampMixin, Base):
    """A composition of pieces from one owner's archive. Always private."""

    __tablename__ = "outfits"
    __table_args__ = (
        CheckConstraint("char_length(btrim(name)) > 0", name="name_not_blank"),
        CheckConstraint(f"layout IN ({sql_in(OutfitLayout)})", name="layout"),
        CheckConstraint(f"season IS NULL OR season IN ({sql_in(OutfitSeason)})", name="season"),
        # Target for the composite foreign keys on outfit_items and collection_outfits.
        UniqueConstraint("id", "user_id"),
        Index("ix_outfits_user_id_updated_at", "user_id", text("updated_at DESC")),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    occasion: Mapped[str | None] = mapped_column(String(80))
    season: Mapped[str | None] = mapped_column(String(20))
    style_tags: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=text("'{}'::text[]"))
    notes: Mapped[str | None] = mapped_column(Text)
    layout: Mapped[str] = mapped_column(String(20), server_default=OutfitLayout.FEATURE.value)


class OutfitItem(CreatedAtMixin, Base):
    """One piece in an outfit.

    user_id is stored here so two composite foreign keys can guarantee, in the database itself,
    that the outfit and the piece belong to the same owner. Deleting a piece removes only this
    row, so the outfit survives with its remaining pieces.
    """

    __tablename__ = "outfit_items"
    __table_args__ = (
        ForeignKeyConstraint(
            ["outfit_id", "user_id"],
            ["outfits.id", "outfits.user_id"],
            ondelete="CASCADE",
            name="fk_outfit_items_outfit_owner",
        ),
        ForeignKeyConstraint(
            ["item_id", "user_id"],
            ["items.id", "items.user_id"],
            ondelete="CASCADE",
            name="fk_outfit_items_item_owner",
        ),
        CheckConstraint("position >= 0", name="non_negative_position"),
        CheckConstraint(f"role IN ({sql_in(OutfitPieceRole)})", name="role"),
        UniqueConstraint("outfit_id", "position"),
        Index("ix_outfit_items_item_id", "item_id"),
    )

    outfit_id: Mapped[UUID] = mapped_column(primary_key=True)
    item_id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column()
    position: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String(20), server_default=OutfitPieceRole.PIECE.value)

    item: Mapped["Item"] = relationship(
        primaryjoin="OutfitItem.item_id == Item.id", foreign_keys=[item_id], viewonly=True
    )


class CollectionOutfit(CreatedAtMixin, Base):
    """An outfit organised into a collection. Never read by the public showcase."""

    __tablename__ = "collection_outfits"
    __table_args__ = (
        ForeignKeyConstraint(
            ["collection_id", "user_id"],
            ["collections.id", "collections.user_id"],
            ondelete="CASCADE",
            name="fk_collection_outfits_collection_owner",
        ),
        ForeignKeyConstraint(
            ["outfit_id", "user_id"],
            ["outfits.id", "outfits.user_id"],
            ondelete="CASCADE",
            name="fk_collection_outfits_outfit_owner",
        ),
        Index("ix_collection_outfits_outfit_id", "outfit_id"),
    )

    collection_id: Mapped[UUID] = mapped_column(primary_key=True)
    outfit_id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column()
