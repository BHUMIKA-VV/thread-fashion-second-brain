"""What the public showcase says about a piece: never notes, source URLs, file details,
processing state or deep analysis, which stay private even on a published piece."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, computed_field

from app.models.enums import ItemType
from app.schemas.items import FamilyCount, PaletteRead, TagCount


class ShowcaseTag(BaseModel):
    category: str
    tag: str


class ShowcaseItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    type: ItemType
    width: int
    height: int
    created_at: datetime
    palette: PaletteRead | None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def image_url(self) -> str:
        return f"/showcase/items/{self.id}/image?variant=original"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def thumbnail_url(self) -> str:
        return f"/showcase/items/{self.id}/image?variant=thumbnail"


class ShowcaseItemDetail(ShowcaseItem):
    tags: list[ShowcaseTag] = Field(description="The tags the owner keeps visible")


class ShowcaseList(BaseModel):
    items: list[ShowcaseItem]
    total: int
    limit: int
    offset: int
    reasons: dict[str, list[str]] = Field(default_factory=dict)


class ShowcaseSimilarItem(BaseModel):
    item: ShowcaseItem
    similarity: float


class ShowcaseSimilar(BaseModel):
    item_id: UUID
    results: list[ShowcaseSimilarItem]
    compared: int = Field(description="Other published pieces that were compared")


class ShowcaseSummary(BaseModel):
    owner_name: str
    total: int
    by_type: dict[str, int]
    color_families: list[FamilyCount]
    tags: list[TagCount]
    collections: int
    recent: list[ShowcaseItem]


class ShowcaseCollectionSummary(BaseModel):
    id: UUID
    name: str
    description: str | None
    item_count: int
    cover_thumbnails: list[str]


class ShowcaseCollection(BaseModel):
    id: UUID
    name: str
    description: str | None
    items: list[ShowcaseItem] = Field(description="The first 200 published pieces, in order")
    total: int = Field(description="Published pieces in the collection (may exceed len(items))")
