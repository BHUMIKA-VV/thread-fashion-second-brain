from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, UrlConstraints, computed_field

from app.models.enums import ItemType, ProcessingStatus

# http(s) only: rejects javascript:, data:, file: and friends.
SourceUrl = Annotated[
    AnyHttpUrl, UrlConstraints(max_length=2048, allowed_schemes=["http", "https"])
]


class ItemRead(BaseModel):
    """Public view of an item. Storage keys and content hashes are never exposed."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    type: ItemType
    suggested_type: ItemType | None
    notes: str | None
    source_url: str | None
    processing_status: ProcessingStatus
    processing_error: str | None
    width: int
    height: int
    mime_type: str
    file_size: int
    created_at: datetime
    updated_at: datetime

    # Paths relative to the API root (the frontend prefixes its /api proxy).
    @computed_field  # type: ignore[prop-decorator]
    @property
    def image_url(self) -> str:
        return f"/items/{self.id}/image?variant=original"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def thumbnail_url(self) -> str:
        return f"/items/{self.id}/image?variant=thumbnail"


class ItemList(BaseModel):
    items: list[ItemRead]
    total: int
    limit: int
    offset: int


class ItemUpdate(BaseModel):
    """PATCH body. Omitted fields are left unchanged; null clears notes / source_url."""

    model_config = ConfigDict(extra="forbid")

    type: ItemType | None = None
    notes: str | None = Field(default=None, max_length=5000)
    source_url: SourceUrl | None = None
