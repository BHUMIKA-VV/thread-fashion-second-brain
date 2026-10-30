from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAtMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.item import Item
    from app.models.user import User


class Collection(TimestampMixin, Base):
    """A private mood board, e.g. "Summer linen"."""

    __tablename__ = "collections"
    __table_args__ = (
        CheckConstraint("char_length(btrim(name)) > 0", name="name_not_blank"),
        # Target for the composite foreign key on collection_items.
        UniqueConstraint("id", "user_id"),
        # Names are unique per user, ignoring case ("Summer Linen" == "summer linen").
        Index(
            "uq_collections_user_id_lower_name", "user_id", func.lower(text("name")), unique=True
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # Shown in the public showcase (with only its public pieces). Owner account only.
    is_public: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)

    user: Mapped["User"] = relationship(back_populates="collections")
    item_links: Mapped[list["CollectionItem"]] = relationship(
        back_populates="collection",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="CollectionItem.position",
        primaryjoin="CollectionItem.collection_id == Collection.id",
        foreign_keys="CollectionItem.collection_id",
    )


class CollectionItem(CreatedAtMixin, Base):
    """Membership of an item in a collection.

    user_id is stored here so two composite foreign keys can guarantee, in the database
    itself, that the collection and the item belong to the same owner.
    """

    __tablename__ = "collection_items"
    __table_args__ = (
        ForeignKeyConstraint(
            ["collection_id", "user_id"],
            ["collections.id", "collections.user_id"],
            ondelete="CASCADE",
            name="fk_collection_items_collection_owner",
        ),
        ForeignKeyConstraint(
            ["item_id", "user_id"],
            ["items.id", "items.user_id"],
            ondelete="CASCADE",
            name="fk_collection_items_item_owner",
        ),
        CheckConstraint("position >= 0", name="non_negative_position"),
        Index("ix_collection_items_item_id", "item_id"),
    )

    collection_id: Mapped[UUID] = mapped_column(primary_key=True)
    item_id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column()
    position: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    note: Mapped[str | None] = mapped_column(Text)

    # The ORM joins on the id columns only; user_id is set explicitly by the repository and
    # checked by the composite foreign keys above.
    collection: Mapped["Collection"] = relationship(
        back_populates="item_links",
        primaryjoin="CollectionItem.collection_id == Collection.id",
        foreign_keys=[collection_id],
    )
    item: Mapped["Item"] = relationship(
        back_populates="collection_links",
        primaryjoin="CollectionItem.item_id == Item.id",
        foreign_keys=[item_id],
    )
