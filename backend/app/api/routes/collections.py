"""Collections (mood boards). Private to their owner; deleting one never deletes items."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUserId
from app.db.session import get_db
from app.models import Collection
from app.repositories.collections import CollectionRepository
from app.schemas.collections import (
    CollectionCreate,
    CollectionDetail,
    CollectionEntry,
    CollectionItemAdd,
    CollectionItemUpdate,
    CollectionSummary,
    CollectionUpdate,
)
from app.schemas.items import ItemRead

router = APIRouter(prefix="/collections", tags=["collections"])
CONFLICT = {409: {"description": "You already have a collection with this name (code conflict)"}}


def get_repo(
    user_id: CurrentUserId, db: Annotated[Session, Depends(get_db)]
) -> CollectionRepository:
    return CollectionRepository(db, user_id)


Repo = Annotated[CollectionRepository, Depends(get_repo)]


def _detail(repo: CollectionRepository, collection: Collection) -> CollectionDetail:
    return CollectionDetail(
        id=collection.id,
        name=collection.name,
        description=collection.description,
        created_at=collection.created_at,
        updated_at=collection.updated_at,
        items=[
            CollectionEntry(
                item=ItemRead.model_validate(link.item),
                note=link.note,
                position=link.position,
                added_at=link.created_at,
            )
            for link in repo.links(collection.id)
        ],
    )


@router.get("", response_model=list[CollectionSummary])
def list_collections(
    repo: Repo,
    item_id: Annotated[
        UUID | None, Query(description="Report whether this item is in each")
    ] = None,
) -> list[CollectionSummary]:
    return [
        CollectionSummary(
            id=c.id,
            name=c.name,
            description=c.description,
            item_count=count,
            cover_thumbnails=[ItemRead.model_validate(i).thumbnail_url for i in covers],
            contains_item=contains if item_id is not None else None,
            created_at=c.created_at,
            updated_at=c.updated_at,
        )
        for c, count, covers, contains in repo.summaries(contains_item=item_id)
    ]


@router.post(
    "", response_model=CollectionDetail, status_code=status.HTTP_201_CREATED, responses=CONFLICT
)
def create_collection(body: CollectionCreate, repo: Repo) -> CollectionDetail:
    collection = repo.create(body.name, body.description or None)
    repo.db.commit()
    return _detail(repo, collection)


@router.get("/{collection_id}", response_model=CollectionDetail)
def get_collection(collection_id: UUID, repo: Repo) -> CollectionDetail:
    return _detail(repo, repo.get_or_raise(collection_id))


@router.patch("/{collection_id}", response_model=CollectionDetail, responses=CONFLICT)
def update_collection(collection_id: UUID, body: CollectionUpdate, repo: Repo) -> CollectionDetail:
    changes = body.model_dump(exclude_unset=True)
    kwargs: dict[str, object] = {}
    if changes.get("name") is not None:
        kwargs["name"] = changes["name"]
    if "description" in changes:
        kwargs["description"] = changes["description"] or None
    collection = repo.update(collection_id, **kwargs)  # type: ignore[arg-type]
    repo.db.commit()
    return _detail(repo, collection)


@router.delete("/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_collection(collection_id: UUID, repo: Repo) -> Response:
    """Deletes the collection and its memberships. The items stay in your library."""
    repo.delete(collection_id)
    repo.db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{collection_id}/items", response_model=CollectionDetail)
def add_collection_item(
    collection_id: UUID, body: CollectionItemAdd, repo: Repo
) -> CollectionDetail:
    """Append one of your items. Adding an item that is already there changes nothing."""
    repo.add_item(collection_id, body.item_id, body.note or None)
    repo.db.commit()
    return _detail(repo, repo.get_or_raise(collection_id))


@router.patch("/{collection_id}/items/{item_id}", response_model=CollectionDetail)
def update_collection_item(
    collection_id: UUID, item_id: UUID, body: CollectionItemUpdate, repo: Repo
) -> CollectionDetail:
    changes = body.model_dump(exclude_unset=True)
    if "note" in changes:
        repo.set_note(collection_id, item_id, changes["note"] or None)
    if changes.get("position") is not None:
        repo.move(collection_id, item_id, changes["position"])
    repo.db.commit()
    return _detail(repo, repo.get_or_raise(collection_id))


@router.delete("/{collection_id}/items/{item_id}", response_model=CollectionDetail)
def remove_collection_item(collection_id: UUID, item_id: UUID, repo: Repo) -> CollectionDetail:
    repo.remove_item(collection_id, item_id)
    repo.db.commit()
    return _detail(repo, repo.get_or_raise(collection_id))
