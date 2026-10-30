from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.models.enums import OutfitLayout, OutfitPieceRole, OutfitSeason
from app.schemas.items import ItemRead

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
Occasion = Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)]
StyleTag = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
StyleTags = Annotated[list[StyleTag], Field(max_length=12)]


class OutfitCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    description: LongText | None = None
    occasion: Occasion | None = None
    season: OutfitSeason | None = None
    style_tags: StyleTags = []
    notes: LongText | None = None
    layout: OutfitLayout = OutfitLayout.FEATURE


class OutfitUpdate(BaseModel):
    """Omitted fields are unchanged; null clears description, occasion, season or notes."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    description: LongText | None = None
    occasion: Occasion | None = None
    season: OutfitSeason | None = None
    style_tags: StyleTags | None = None
    notes: LongText | None = None
    layout: OutfitLayout | None = None


class OutfitPieceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: UUID
    role: OutfitPieceRole = OutfitPieceRole.PIECE


class OutfitItemsReplace(BaseModel):
    """The outfit's whole ordered list. Replaced all at once, or not at all."""

    model_config = ConfigDict(extra="forbid")

    # The 12-piece limit is enforced by the service; this only bounds the request size.
    items: Annotated[list[OutfitPieceInput], Field(max_length=100)]


class OutfitColourRead(BaseModel):
    hex: str
    name: str
    share: float = Field(description="Average share across the pieces that have a palette")
    item_ids: list[UUID]


class OutfitColoursRead(BaseModel):
    """Visual relationships calculated from stored palettes; not fashion rules."""

    dominant: list[OutfitColourRead]
    shared: list[OutfitColourRead]
    complementary: list[tuple[OutfitColourRead, OutfitColourRead]]
    contrasting: list[tuple[OutfitColourRead, OutfitColourRead]]
    pieces_with_palette: int
    pieces_without_palette: int


class OutfitPieceRead(BaseModel):
    item: ItemRead
    role: OutfitPieceRole
    position: int


class OutfitSummary(BaseModel):
    id: UUID
    name: str
    description: str | None
    occasion: str | None
    season: OutfitSeason | None
    style_tags: list[str]
    layout: OutfitLayout
    piece_count: int
    cover_thumbnails: list[str] = Field(description="API-relative thumbnail URLs of the first 4")
    created_at: datetime
    updated_at: datetime


class OutfitList(BaseModel):
    outfits: list[OutfitSummary]
    total: int
    limit: int
    offset: int


class OutfitDetail(BaseModel):
    id: UUID
    name: str
    description: str | None
    occasion: str | None
    season: OutfitSeason | None
    style_tags: list[str]
    notes: str | None
    layout: OutfitLayout
    created_at: datetime
    updated_at: datetime
    pieces: list[OutfitPieceRead]
    colours: OutfitColoursRead
    collection_ids: list[UUID]


class CollectionOutfitAdd(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outfit_id: UUID
