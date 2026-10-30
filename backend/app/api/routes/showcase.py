"""The public showcase (/showcase): anyone may read, nobody may write.

Only GET routes live here. Everything is the owner's published pieces and collections; see
app/services/showcase.py for the filtering and app/schemas/showcase.py for what is shown.
"""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.api.deps import get_storage
from app.api.routes.items import ColorFamily
from app.db.session import get_db
from app.models.enums import ItemType
from app.repositories.search import SearchParams, Sort, parse_tag
from app.schemas.items import FamilyCount, TagCount
from app.schemas.showcase import (
    ShowcaseCollection,
    ShowcaseCollectionSummary,
    ShowcaseItem,
    ShowcaseItemDetail,
    ShowcaseList,
    ShowcaseSimilar,
    ShowcaseSimilarItem,
    ShowcaseSummary,
    ShowcaseTag,
)
from app.services.showcase import ShowcaseService
from app.storage import Storage

router = APIRouter(prefix="/showcase", tags=["showcase"])

NOT_SET_UP = {404: {"description": "No owner account yet (code showcase_not_set_up)"}}

# Published images may be cached briefly by browsers and proxies: after a piece is
# unpublished, a cached copy can be seen for at most this long.
PUBLIC_FILE_HEADERS = {
    "Cache-Control": "public, max-age=300",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
}


def get_showcase(
    db: Annotated[Session, Depends(get_db)], storage: Annotated[Storage, Depends(get_storage)]
) -> ShowcaseService:
    return ShowcaseService(db, storage)


Showcase = Annotated[ShowcaseService, Depends(get_showcase)]


@router.get("", response_model=ShowcaseSummary, responses=NOT_SET_UP)
def showcase_summary(showcase: Showcase) -> ShowcaseSummary:
    """Who this Thread belongs to, and counts over the published pieces only."""
    summary = showcase.summary()
    return ShowcaseSummary(
        owner_name=showcase.owner_name,
        total=summary.total,
        by_type=summary.by_type,
        color_families=[FamilyCount(family=f, items=n) for f, n in summary.color_families],
        tags=[TagCount(category=c, tag=t, items=n) for c, t, n in summary.tags],
        collections=summary.collections,
        recent=[ShowcaseItem.model_validate(i) for i in summary.recent],
    )


@router.get("/items", response_model=ShowcaseList, responses=NOT_SET_UP)
def showcase_items(
    showcase: Showcase,
    q: Annotated[str | None, Query(max_length=100)] = None,
    tag: Annotated[list[str], Query(max_length=10)] = [],  # noqa: B006
    color: Annotated[list[ColorFamily], Query(max_length=13)] = [],  # noqa: B006
    type: Annotated[ItemType | None, Query()] = None,  # noqa: A002
    sort: Annotated[Sort, Query()] = "newest",
    limit: Annotated[int, Query(ge=1, le=100)] = 48,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ShowcaseList:
    """Published pieces, filtered. Text search covers visible tags, colour names and
    families and type; never notes or source URLs."""
    params = SearchParams(
        q=q.strip() if q and q.strip() else None,
        tags=[parse_tag(t) for t in tag if t.strip()],
        colors=[c.value for c in color],
        item_type=type.value if type else None,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    page = showcase.search(params)
    return ShowcaseList(
        items=[ShowcaseItem.model_validate(row) for row in page.items],
        total=page.total,
        limit=limit,
        offset=offset,
        reasons={str(k): v for k, v in page.reasons.items()},
    )


@router.get("/items/{item_id}", response_model=ShowcaseItemDetail, responses=NOT_SET_UP)
def showcase_item(item_id: UUID, showcase: Showcase) -> ShowcaseItemDetail:
    item = showcase.piece(item_id)
    return ShowcaseItemDetail(
        **ShowcaseItem.model_validate(item).model_dump(exclude={"image_url", "thumbnail_url"}),
        tags=[ShowcaseTag(category=c, tag=t) for c, t in showcase.tags(item_id)],
    )


@router.get(
    "/items/{item_id}/image",
    response_class=Response,
    responses={200: {"content": {"image/jpeg": {}, "image/png": {}, "image/webp": {}}}},
)
def showcase_image(
    item_id: UUID,
    showcase: Showcase,
    variant: Annotated[Literal["original", "thumbnail"], Query()] = "thumbnail",
) -> Response:
    data, mime_type = showcase.image(item_id, variant)
    return Response(content=data, media_type=mime_type, headers=PUBLIC_FILE_HEADERS)


@router.get("/items/{item_id}/similar", response_model=ShowcaseSimilar, responses=NOT_SET_UP)
def showcase_similar(
    item_id: UUID, showcase: Showcase, limit: Annotated[int, Query(ge=1, le=24)] = 8
) -> ShowcaseSimilar:
    """The most visually similar published pieces (stored vectors only; nothing is indexed)."""
    results, compared = showcase.similar(item_id, limit)
    return ShowcaseSimilar(
        item_id=item_id,
        results=[
            ShowcaseSimilarItem(item=ShowcaseItem.model_validate(r.item), similarity=r.similarity)
            for r in results
        ],
        compared=compared,
    )


@router.get("/collections", response_model=list[ShowcaseCollectionSummary], responses=NOT_SET_UP)
def showcase_collections(showcase: Showcase) -> list[ShowcaseCollectionSummary]:
    """Published collections, most recently updated first; at most 50."""
    return [
        ShowcaseCollectionSummary(
            id=c.id,
            name=c.name,
            description=c.description,
            item_count=count,
            cover_thumbnails=[f"/showcase/items/{i}/image?variant=thumbnail" for i in covers],
        )
        for c, count, covers in showcase.collections()
    ]


@router.get("/collections/{collection_id}", response_model=ShowcaseCollection, responses=NOT_SET_UP)
def showcase_collection(collection_id: UUID, showcase: Showcase) -> ShowcaseCollection:
    """A published collection with only its published pieces (the first 200, in order;
    `total` counts them all); per-piece notes stay private."""
    collection, items, total = showcase.collection(collection_id)
    return ShowcaseCollection(
        id=collection.id,
        name=collection.name,
        description=collection.description,
        items=[ShowcaseItem.model_validate(i) for i in items],
        total=total,
    )
