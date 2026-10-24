from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAtMixin

if TYPE_CHECKING:
    from app.models.collection import Collection
    from app.models.item import Item


class User(CreatedAtMixin, Base):
    """Owner of items and collections. The MVP has one development user."""

    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    display_name: Mapped[str] = mapped_column(String(120))

    items: Mapped[list["Item"]] = relationship(back_populates="user", passive_deletes=True)
    collections: Mapped[list["Collection"]] = relationship(
        back_populates="user", passive_deletes=True
    )
