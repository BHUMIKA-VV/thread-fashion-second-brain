"""Gallery search: text, tag, colour-family and type filters, sorting and match reasons.

Tag rules are exactly those of the tags view (app/services/tags.py): a tag is *visible* when
it is an AI tag the user has not removed, or a tag the user added. `visible_tags()` expresses
that in SQL once; every tag filter, text match and summary uses it.

Text search is case-insensitive substring matching (ILIKE) over visible tags, colour names,
colour families, item type, notes and source URL. That is plenty for a personal library; for
very large libraries a pg_trgm or full-text index would be the next step.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal
from uuid import UUID

from sqlalchemy import (
    ColumnElement,
    Select,
    and_,
    case,
    column,
    exists,
    func,
    literal,
    or_,
    select,
    true,
    union,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session, aliased, selectinload

from app.models import Item, Palette, Tag
from app.models.enums import TagSource, UserTagAction

Sort = Literal["newest", "oldest", "relevance"]

# Relevance weights: an exact tag beats a partial tag, colours and type beat free text.
W_TAG_EXACT, W_TAG_PARTIAL, W_COLOUR, W_TYPE, W_TEXT = 8, 4, 3, 3, 1


@dataclass(frozen=True)
class SearchParams:
    q: str | None = None
    tags: Sequence[tuple[str | None, str]] = ()  # (category or None for any, tag)
    colors: Sequence[str] = ()
    item_type: str | None = None
    sort: Sort = "newest"
    limit: int = 48
    offset: int = 0


@dataclass(frozen=True)
class SearchPage:
    items: list[Item]
    total: int
    reasons: dict[UUID, list[str]] = field(default_factory=dict)


def visible_tags():  # noqa: ANN201 - a SQLAlchemy subquery
    """(item_id, category, tag) for every tag the user currently sees."""
    user = aliased(Tag)
    ai_kept = select(Tag.item_id, Tag.category, Tag.tag).where(
        Tag.source == TagSource.AI.value,
        ~exists().where(
            user.item_id == Tag.item_id,
            user.category == Tag.category,
            user.tag == Tag.tag,
            user.source == TagSource.USER.value,
            user.user_action == UserTagAction.REMOVE.value,
        ),
    )
    user_added = select(Tag.item_id, Tag.category, Tag.tag).where(
        Tag.source == TagSource.USER.value, Tag.user_action == UserTagAction.ADD.value
    )
    return union(ai_kept, user_added).subquery("visible_tags")


def escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def parse_tag(raw: str) -> tuple[str | None, str]:
    """'craft:ikat' -> ('craft', 'ikat'); 'ikat' -> (None, 'ikat'). Lower-cased, trimmed."""
    category, sep, tag = raw.partition(":")
    if sep:
        return category.strip().lower() or None, " ".join(tag.split()).lower()
    return None, " ".join(raw.split()).lower()


class ItemSearch:
    def __init__(self, db: Session, owner_id: UUID) -> None:
        self.db = db
        self.owner_id = owner_id

    def _conditions(self, params: SearchParams, vt) -> list[ColumnElement[bool]]:  # noqa: ANN001
        conditions: list[ColumnElement[bool]] = [Item.user_id == self.owner_id]
        if params.item_type:
            conditions.append(Item.type == params.item_type)
        for category, tag in params.tags:  # every requested tag must be visible on the item
            match = and_(vt.c.item_id == Item.id, vt.c.tag == tag)
            if category:
                match = and_(match, vt.c.category == category)
            conditions.append(exists().where(match))
        for family in params.colors:  # every requested colour family must be in the palette
            conditions.append(
                exists().where(
                    Palette.item_id == Item.id, Palette.color_families.contains([family])
                )
            )
        if params.q:
            conditions.append(self._text_match(params.q, vt) > 0)
        return conditions

    def _text_match(self, q: str, vt) -> ColumnElement[int]:  # noqa: ANN001
        """Relevance score of an item for `q` (0 = no match)."""
        needle = " ".join(q.split()).lower()
        pattern = f"%{escape_like(needle)}%"
        colour = (
            func.jsonb_array_elements(Palette.colors)
            .table_valued(column("value", JSONB))  # typed, so ->> works on it
            .alias("colour")
        )
        tag_exact = exists().where(vt.c.item_id == Item.id, vt.c.tag == needle)
        tag_partial = exists().where(vt.c.item_id == Item.id, vt.c.tag.ilike(pattern, escape="\\"))
        colour_hit = exists(
            select(literal(1))
            .select_from(Palette)
            .join(colour, true())
            .where(
                Palette.item_id == Item.id,
                or_(
                    colour.c.value["name"].astext.ilike(pattern, escape="\\"),
                    colour.c.value["family"].astext == needle,
                ),
            )
        )
        text_hit = or_(
            Item.notes.ilike(pattern, escape="\\"), Item.source_url.ilike(pattern, escape="\\")
        )
        return (
            case((tag_exact, W_TAG_EXACT), else_=0)
            + case((tag_partial, W_TAG_PARTIAL), else_=0)
            + case((colour_hit, W_COLOUR), else_=0)
            + case((Item.type == needle, W_TYPE), else_=0)
            + case((text_hit, W_TEXT), else_=0)
        )

    def search(self, params: SearchParams) -> SearchPage:
        vt = visible_tags()
        conditions = self._conditions(params, vt)
        total = self.db.scalar(select(func.count()).select_from(Item).where(*conditions)) or 0

        query: Select[tuple[Item]] = (
            select(Item).where(*conditions).options(selectinload(Item.palette))
        )
        if params.sort == "relevance" and params.q:
            query = query.order_by(
                self._text_match(params.q, vt).desc(), Item.created_at.desc(), Item.id
            )
        elif params.sort == "oldest":
            query = query.order_by(Item.created_at.asc(), Item.id)
        else:
            query = query.order_by(Item.created_at.desc(), Item.id)
        items = list(self.db.scalars(query.limit(params.limit).offset(params.offset)).all())
        reasons = self._reasons(items, params) if params.q else {}
        return SearchPage(items=items, total=total, reasons=reasons)

    def _reasons(self, items: list[Item], params: SearchParams) -> dict[UUID, list[str]]:
        """Plain-language reasons why each item on this page matched the text query."""
        if not items or not params.q:
            return {}
        needle = " ".join(params.q.split()).lower()
        vt = visible_tags()
        ids = [item.id for item in items]
        tag_rows = self.db.execute(
            select(vt.c.item_id, vt.c.category, vt.c.tag).where(vt.c.item_id.in_(ids))
        ).all()
        by_item: dict[UUID, list[str]] = {item.id: [] for item in items}
        for item_id, category, tag in sorted(tag_rows, key=lambda r: (r[1], r[2])):
            if tag == needle:
                by_item[item_id].insert(0, f"Tag: {category} · {tag}")
            elif needle in tag:
                by_item[item_id].append(f"Tag: {category} · {tag}")
        for item in items:
            reasons = by_item[item.id]
            colours = item.palette.colors if item.palette else []
            names = sorted({c["name"] for c in colours if needle in str(c["name"]).lower()})
            families = sorted({c["family"] for c in colours if str(c["family"]) == needle})
            reasons += [f"Colour: {name}" for name in names]
            reasons += [f"Colour family: {family}" for family in families if not names]
            if item.type == needle:
                reasons.append(f"Type: {item.type}")
            if item.notes and needle in item.notes.lower():
                reasons.append("Notes mention it")
            if item.source_url and needle in item.source_url.lower():
                reasons.append("Source URL mentions it")
        return by_item
