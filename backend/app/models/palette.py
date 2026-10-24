from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.enums import Harmony, PaletteSource, sql_in

if TYPE_CHECKING:
    from app.models.item import Item


class Palette(TimestampMixin, Base):
    """Dominant colours of one item (one row per item)."""

    __tablename__ = "palettes"
    __table_args__ = (
        CheckConstraint(f"harmony IN ({sql_in(Harmony)})", name="harmony"),
        CheckConstraint(f"source IN ({sql_in(PaletteSource)})", name="source"),
        CheckConstraint("jsonb_typeof(colors) = 'array'", name="colors_is_array"),
        # GIN index so "items containing a blue" is an indexed array-overlap query.
        Index("ix_palettes_color_families", "color_families", postgresql_using="gin"),
    )

    item_id: Mapped[UUID] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), primary_key=True
    )
    # [{"hex": "#b4654a", "name": "terracotta", "percentage": 31.5, "lab": [L, a, b]}, ...]
    colors: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    harmony: Mapped[str | None] = mapped_column(String(20))
    # Coarse families ("red", "blue", "neutral", ...) copied out of JSON for fast filtering.
    color_families: Mapped[list[str]] = mapped_column(
        ARRAY(Text), server_default=text("'{}'::text[]")
    )
    source: Mapped[str] = mapped_column(String(20), server_default=PaletteSource.ORIGINAL.value)

    item: Mapped["Item"] = relationship(back_populates="palette")
