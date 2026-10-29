from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Index, String, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAtMixin

if TYPE_CHECKING:
    from app.models.collection import Collection
    from app.models.item import Item


class User(CreatedAtMixin, Base):
    """An account. Owns items and collections; every query is scoped to one user.

    `email` and `password_hash` are empty only for the local development user until it is
    claimed as the owner account (`python -m scripts.claim_owner`).
    """

    __tablename__ = "users"
    __table_args__ = (
        # One account per address, ignoring case.
        Index("uq_users_lower_email", func.lower(text("email")), unique=True),
        # At most one owner: the person whose archive is the public showcase.
        Index("uq_users_single_owner", "is_owner", unique=True, postgresql_where=text("is_owner")),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    display_name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(254))
    password_hash: Mapped[str | None] = mapped_column(String(255))
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_owner: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    items: Mapped[list["Item"]] = relationship(back_populates="user", passive_deletes=True)
    collections: Mapped[list["Collection"]] = relationship(
        back_populates="user", passive_deletes=True
    )
