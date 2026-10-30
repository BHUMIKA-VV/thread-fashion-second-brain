from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schemas.items import ItemRead

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]


class CollectionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    description: Description | None = None


class CollectionUpdate(BaseModel):
    """Omitted fields are unchanged; description null clears it."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    description: Description | None = None


class CollectionItemAdd(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: UUID
    note: Note | None = None


class CollectionItemUpdate(BaseModel):
    """Edit this item's note in the collection and/or move it (0-based position)."""

    model_config = ConfigDict(extra="forbid")

    note: Note | None = None
    position: int | None = Field(default=None, ge=0)


class CollectionSummary(BaseModel):
    id: UUID
    name: str
    description: str | None
    item_count: int
    is_public: bool
    cover_thumbnails: list[str] = Field(description="API-relative thumbnail URLs of the first 4")
    contains_item: bool | None = Field(
        default=None, description="With ?item_id=: whether that item is in this collection"
    )
    created_at: datetime
    updated_at: datetime


class CollectionEntry(BaseModel):
    item: ItemRead
    note: str | None
    position: int
    added_at: datetime


class CollectionDetail(BaseModel):
    id: UUID
    name: str
    description: str | None
    is_public: bool
    created_at: datetime
    updated_at: datetime
    items: list[CollectionEntry]
