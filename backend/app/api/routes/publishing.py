"""The owner's switches for the public showcase. Other accounts can never publish anything,
so nothing a stranger uploads can appear on the public site."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.deps import Owner
from app.db.session import get_db
from app.models import Collection, Item
from app.repositories.errors import NotFoundError
from app.schemas.items import ItemRead

router = APIRouter(tags=["showcase"])

Db = Annotated[Session, Depends(get_db)]
OWNER_ONLY = {403: {"description": "Only the owner can publish (code owner_only)"}}


class Visibility(BaseModel):
    model_config = ConfigDict(extra="forbid")

    public: bool


class VisibilityResult(BaseModel):
    public: bool
    changed: int


@router.put("/items/{item_id}/showcase", response_model=ItemRead, responses=OWNER_ONLY)
def set_item_visibility(item_id: UUID, body: Visibility, owner: Owner, db: Db) -> ItemRead:
    item = db.scalar(select(Item).where(Item.id == item_id, Item.user_id == owner.id))
    if item is None:
        raise NotFoundError("Item not found.")
    item.is_public = body.public
    db.commit()
    return ItemRead.model_validate(item)


@router.post("/items/showcase-all", response_model=VisibilityResult, responses=OWNER_ONLY)
def set_all_items_visibility(body: Visibility, owner: Owner, db: Db) -> VisibilityResult:
    """Publish (or unpublish) every piece in the owner's archive at once."""
    result = db.execute(
        update(Item)
        .where(Item.user_id == owner.id, Item.is_public.is_not(body.public))
        .values(is_public=body.public)
    )
    db.commit()
    return VisibilityResult(public=body.public, changed=result.rowcount or 0)  # type: ignore[attr-defined]


@router.put(
    "/collections/{collection_id}/showcase", response_model=VisibilityResult, responses=OWNER_ONLY
)
def set_collection_visibility(
    collection_id: UUID, body: Visibility, owner: Owner, db: Db
) -> VisibilityResult:
    """A published collection shows only the pieces in it that are published too."""
    collection = db.scalar(
        select(Collection).where(Collection.id == collection_id, Collection.user_id == owner.id)
    )
    if collection is None:
        raise NotFoundError("Collection not found.")
    changed = int(collection.is_public != body.public)
    collection.is_public = body.public
    db.commit()
    return VisibilityResult(public=body.public, changed=changed)
