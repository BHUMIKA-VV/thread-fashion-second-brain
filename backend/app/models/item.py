from datetime import datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.enums import ItemType, ProcessingStatus, sql_in

if TYPE_CHECKING:
    from app.models.collection import CollectionItem
    from app.models.embedding import Embedding
    from app.models.palette import Palette
    from app.models.tag import Tag
    from app.models.user import User


class Item(TimestampMixin, Base):
    """One saved image plus its analysis state."""

    __tablename__ = "items"
    __table_args__ = (
        CheckConstraint(f"type IN ({sql_in(ItemType)})", name="type"),
        CheckConstraint(f"suggested_type IN ({sql_in(ItemType)})", name="suggested_type"),
        CheckConstraint(
            f"processing_status IN ({sql_in(ProcessingStatus)})", name="processing_status"
        ),
        CheckConstraint("content_hash ~ '^[0-9a-f]{64}$'", name="content_hash_sha256"),
        CheckConstraint("width > 0 AND height > 0", name="positive_dimensions"),
        CheckConstraint("file_size > 0", name="positive_file_size"),
        CheckConstraint("attempts >= 0", name="non_negative_attempts"),
        CheckConstraint("char_length(source_url) <= 2048", name="source_url_length"),
        # Same file uploaded twice by one user is a duplicate; other users may own the same file.
        UniqueConstraint("user_id", "content_hash"),
        # Target for composite foreign keys that pin collection_items to one owner.
        UniqueConstraint("id", "user_id"),
        Index("ix_items_user_id_created_at", "user_id", text("created_at DESC")),
        Index("ix_items_user_id_type", "user_id", "type"),
        # Small partial index the worker uses to find pending work.
        Index(
            "ix_items_pending",
            "created_at",
            postgresql_where=text("processing_status IN ('queued', 'processing')"),
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))

    type: Mapped[str] = mapped_column(String(20), server_default=ItemType.OTHER.value)
    suggested_type: Mapped[str | None] = mapped_column(String(20))

    # Storage keys (relative, server-generated), never filesystem paths or public URLs.
    original_key: Mapped[str] = mapped_column(String(512))
    thumbnail_key: Mapped[str | None] = mapped_column(String(512))
    cutout_key: Mapped[str | None] = mapped_column(String(512))

    content_hash: Mapped[str] = mapped_column(String(64))
    mime_type: Mapped[str] = mapped_column(String(50))
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    file_size: Mapped[int] = mapped_column(Integer)

    notes: Mapped[str | None] = mapped_column(Text)
    source_url: Mapped[str | None] = mapped_column(Text)

    processing_status: Mapped[str] = mapped_column(
        String(30), server_default=ProcessingStatus.QUEUED.value
    )
    # User-safe summary only; stack traces go to logs.
    processing_error: Mapped[str | None] = mapped_column(Text)
    # Per-stage outcome, e.g. {"palette": "completed", "background": "failed"}.
    stage_status: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    attempts: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    analyzed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    ai_description: Mapped[str | None] = mapped_column(Text)
    ai_description_model: Mapped[str | None] = mapped_column(String(100))

    user: Mapped["User"] = relationship(back_populates="items")
    palette: Mapped["Palette | None"] = relationship(
        back_populates="item", cascade="all, delete-orphan", passive_deletes=True
    )
    tags: Mapped[list["Tag"]] = relationship(
        back_populates="item", cascade="all, delete-orphan", passive_deletes=True
    )
    embedding: Mapped["Embedding | None"] = relationship(
        back_populates="item", cascade="all, delete-orphan", passive_deletes=True
    )
    collection_links: Mapped[list["CollectionItem"]] = relationship(
        back_populates="item",
        cascade="all, delete-orphan",
        passive_deletes=True,
        primaryjoin="CollectionItem.item_id == Item.id",
        foreign_keys="CollectionItem.item_id",
    )
