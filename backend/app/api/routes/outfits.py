"""Outfit Studio. Private to their owner; nothing here is ever part of the public showcase."""

from dataclasses import asdict
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUserId
from app.db.session import get_db
from app.models import Outfit
from app.models.enums import OutfitSeason
from app.repositories.outfits import PieceEntry
from app.schemas.items import ItemRead
from app.schemas.outfits import (
    OutfitColoursRead,
    OutfitCreate,
    OutfitDetail,
    OutfitItemsReplace,
    OutfitList,
    OutfitPieceRead,
    OutfitSummary,
    OutfitUpdate,
)
from app.services.outfits import OutfitService, normalise_style_tags

router = APIRouter(prefix="/outfits", tags=["outfits"])
LIMITED = {409: {"description": "The account's outfit limit is reached (code outfit_limit)"}}


def get_service(user_id: CurrentUserId, db: Annotated[Session, Depends(get_db)]) -> OutfitService:
    return OutfitService(db, user_id)


Service = Annotated[OutfitService, Depends(get_service)]


def _detail(service: OutfitService, outfit: Outfit) -> OutfitDetail:
    links = service.repo.links(outfit.id)
    return OutfitDetail(
        id=outfit.id,
        name=outfit.name,
        description=outfit.description,
        occasion=outfit.occasion,
        season=outfit.season,
        style_tags=outfit.style_tags,
        notes=outfit.notes,
        layout=outfit.layout,
        created_at=outfit.created_at,
        updated_at=outfit.updated_at,
        # Numbered here: deleting a piece can leave a gap in the stored positions.
        pieces=[
            OutfitPieceRead(item=ItemRead.model_validate(link.item), role=link.role, position=i)
            for i, link in enumerate(links)
        ],
        colours=OutfitColoursRead.model_validate(asdict(service.colours(links))),
        collection_ids=service.repo.collection_ids(outfit.id),
    )


def outfit_summaries(service: OutfitService, outfits: list[Outfit]) -> list[OutfitSummary]:
    previews = service.repo.previews([outfit.id for outfit in outfits])
    return [
        OutfitSummary(
            id=o.id,
            name=o.name,
            description=o.description,
            occasion=o.occasion,
            season=o.season,
            style_tags=o.style_tags,
            layout=o.layout,
            piece_count=len(previews[o.id]),
            cover_thumbnails=[f"/items/{i}/image?variant=thumbnail" for i in previews[o.id][:4]],
            created_at=o.created_at,
            updated_at=o.updated_at,
        )
        for o in outfits
    ]


@router.get("", response_model=OutfitList)
def list_outfits(
    service: Service,
    q: Annotated[str | None, Query(max_length=100, description="Text search")] = None,
    occasion: Annotated[str | None, Query(max_length=80)] = None,
    season: Annotated[OutfitSeason | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 24,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> OutfitList:
    """Your outfits, most recently changed first."""
    rows, total = service.repo.page(
        q=q.strip() if q and q.strip() else None,
        occasion=occasion.strip() if occasion and occasion.strip() else None,
        season=season.value if season else None,
        limit=limit,
        offset=offset,
    )
    return OutfitList(
        outfits=outfit_summaries(service, list(rows)), total=total, limit=limit, offset=offset
    )


@router.post(
    "", response_model=OutfitDetail, status_code=status.HTTP_201_CREATED, responses=LIMITED
)
def create_outfit(body: OutfitCreate, service: Service) -> OutfitDetail:
    outfit = service.create(
        body.name,
        description=body.description or None,
        occasion=body.occasion or None,
        season=body.season.value if body.season else None,
        style_tags=normalise_style_tags(body.style_tags),
        notes=body.notes or None,
        layout=body.layout.value,
    )
    service.db.commit()
    return _detail(service, outfit)


@router.get("/{outfit_id}", response_model=OutfitDetail)
def get_outfit(outfit_id: UUID, service: Service) -> OutfitDetail:
    return _detail(service, service.repo.get_or_raise(outfit_id))


@router.patch("/{outfit_id}", response_model=OutfitDetail)
def update_outfit(outfit_id: UUID, body: OutfitUpdate, service: Service) -> OutfitDetail:
    outfit = service.repo.get_or_raise(outfit_id, lock=True)
    changes = body.model_dump(exclude_unset=True)
    if changes.get("name") is not None:
        outfit.name = changes["name"]
    for field in ("description", "occasion", "notes"):
        if field in changes:
            setattr(outfit, field, changes[field] or None)
    if "season" in changes:
        outfit.season = changes["season"].value if changes["season"] else None
    if changes.get("style_tags") is not None:
        outfit.style_tags = normalise_style_tags(changes["style_tags"])
    if changes.get("layout") is not None:
        outfit.layout = changes["layout"].value
    service.db.commit()
    return _detail(service, outfit)


@router.delete("/{outfit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_outfit(outfit_id: UUID, service: Service) -> Response:
    """Deletes the outfit only. Its pieces stay in your library."""
    service.repo.delete(outfit_id)
    service.db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{outfit_id}/items", response_model=OutfitDetail)
def replace_outfit_items(
    outfit_id: UUID, body: OutfitItemsReplace, service: Service
) -> OutfitDetail:
    """Add, remove, replace and reorder in one step: the list you send becomes the outfit.
    If anything is wrong with it, the outfit stays exactly as it was."""
    outfit = service.replace_items(
        outfit_id, [PieceEntry(entry.item_id, entry.role.value) for entry in body.items]
    )
    service.db.commit()
    return _detail(service, outfit)


@router.post(
    "/{outfit_id}/duplicate",
    response_model=OutfitDetail,
    status_code=status.HTTP_201_CREATED,
    responses=LIMITED,
)
def duplicate_outfit(outfit_id: UUID, service: Service) -> OutfitDetail:
    copy = service.duplicate(outfit_id)
    service.db.commit()
    return _detail(service, copy)
