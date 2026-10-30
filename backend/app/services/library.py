"""Library summary for the dashboard and gallery filters: real counts only, no inferences."""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session, selectinload

from app.models import Collection, Item, Palette
from app.repositories.search import visible_tags


@dataclass(frozen=True)
class LibrarySummary:
    total: int
    by_type: dict[str, int]
    by_status: dict[str, int]
    color_families: list[tuple[str, int]]  # most common first
    tags: list[tuple[str, str, int]]  # (category, tag, items) most common first
    collections: int
    recent: list[Item]


def library_summary(
    db: Session, owner_id: UUID, *, top: int = 12, recent: int = 6, public_only: bool = False
) -> LibrarySummary:
    """Counts for one owner; with public_only (the showcase), only published pieces and
    collections are counted, so the numbers reveal nothing about private ones."""
    mine = Item.user_id == owner_id
    if public_only:
        mine = and_(mine, Item.is_public.is_(True))
    by_type = dict(
        db.execute(select(Item.type, func.count()).where(mine).group_by(Item.type)).all()
    )
    by_status = dict(
        db.execute(
            select(Item.processing_status, func.count())
            .where(mine)
            .group_by(Item.processing_status)
        ).all()
    )
    family = func.unnest(Palette.color_families).label("family")
    families_sub = (
        select(Palette.item_id, family)
        .join(Item, Item.id == Palette.item_id)
        .where(mine)
        .subquery()
    )
    color_families = db.execute(
        select(families_sub.c.family, func.count(func.distinct(families_sub.c.item_id)).label("n"))
        .group_by(families_sub.c.family)
        .order_by(func.count(func.distinct(families_sub.c.item_id)).desc(), families_sub.c.family)
        .limit(top)
    ).all()
    vt = visible_tags()
    tags = db.execute(
        select(vt.c.category, vt.c.tag, func.count(func.distinct(vt.c.item_id)).label("n"))
        .join(Item, Item.id == vt.c.item_id)
        .where(mine)
        .group_by(vt.c.category, vt.c.tag)
        .order_by(func.count(func.distinct(vt.c.item_id)).desc(), vt.c.category, vt.c.tag)
        .limit(top)
    ).all()
    return LibrarySummary(
        total=sum(by_type.values()),
        by_type=by_type,
        by_status=by_status,
        color_families=[(f, n) for f, n in color_families],
        tags=[(c, t, n) for c, t, n in tags],
        collections=db.scalar(
            select(func.count())
            .select_from(Collection)
            .where(
                Collection.user_id == owner_id,
                *([Collection.is_public.is_(True)] if public_only else []),
            )
        )
        or 0,
        recent=list(
            db.scalars(
                select(Item)
                .where(mine)
                .options(selectinload(Item.palette))
                .order_by(Item.created_at.desc(), Item.id)
                .limit(recent)
            ).all()
        ),
    )
