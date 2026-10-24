from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.enums import TagCategory, TagSource, UserTagAction, sql_in

if TYPE_CHECKING:
    from app.models.item import Item


class Tag(TimestampMixin, Base):
    """A predicted or user-supplied tag.

    AI predictions and user corrections live in separate rows (source='ai' / 'user').
    Re-analysis rewrites only AI rows, so corrections are never overwritten.
    Effective tags = AI tags + user "add" rows - user "remove" rows.
    """

    __tablename__ = "tags"
    __table_args__ = (
        CheckConstraint(f"category IN ({sql_in(TagCategory)})", name="category"),
        CheckConstraint(f"source IN ({sql_in(TagSource)})", name="source"),
        CheckConstraint(
            f"user_action IS NULL OR user_action IN ({sql_in(UserTagAction)})",
            name="user_action",
        ),
        CheckConstraint("confidence IS NULL OR confidence BETWEEN 0 AND 1", name="confidence"),
        CheckConstraint("char_length(btrim(tag)) > 0", name="tag_not_blank"),
        # AI rows carry a model score and no user action; user rows the reverse.
        CheckConstraint(
            "(source = 'ai' AND user_action IS NULL AND confidence IS NOT NULL"
            " AND NOT is_user_edited)"
            " OR (source = 'user' AND user_action IS NOT NULL AND is_user_edited)",
            name="source_consistency",
        ),
        UniqueConstraint("item_id", "category", "tag", "source"),
        Index("ix_tags_category_tag", "category", "tag"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    item_id: Mapped[UUID] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), index=True)
    tag: Mapped[str] = mapped_column(String(80))
    category: Mapped[str] = mapped_column(String(20))
    # Raw model score (softmax within a category); NOT a calibrated probability.
    confidence: Mapped[float | None] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(10))
    user_action: Mapped[str | None] = mapped_column(String(10))
    is_user_edited: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    model_name: Mapped[str | None] = mapped_column(String(100))

    item: Mapped["Item"] = relationship(back_populates="tags")
