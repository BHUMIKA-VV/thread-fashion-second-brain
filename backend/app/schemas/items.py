from datetime import datetime
from enum import Enum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, UrlConstraints, computed_field

from app.color.naming import FAMILIES
from app.models.enums import Harmony, ItemType, PaletteSource, ProcessingStatus

# http(s) only: rejects javascript:, data:, file: and friends.
SourceUrl = Annotated[
    AnyHttpUrl, UrlConstraints(max_length=2048, allowed_schemes=["http", "https"])
]


class PaletteColorRead(BaseModel):
    hex: str = Field(description="sRGB hex of the displayed swatch, e.g. #e3a018")
    rgb: tuple[int, int, int]
    name: str = Field(description="Nearest name from the xkcd survey or the Indian vocabulary")
    family: str = Field(description="Coarse family used for filtering, e.g. 'blue', 'beige'")
    percentage: float = Field(description="Approximate share of the analysed pixels")


class PaletteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    colors: list[PaletteColorRead]
    harmony: Harmony | None = Field(description="Heuristic label, not a measurement")
    source: PaletteSource = Field(
        description="original = whole image; masked = plain backdrop excluded"
    )
    updated_at: datetime


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
    # Per-stage outcome, e.g. {"thumbnail": "completed", "palette": "failed"}.
    stage_status: dict[str, str]
    palette: PaletteRead | None

    # Paths relative to the API root (the frontend prefixes its /api proxy).
    @computed_field  # type: ignore[prop-decorator]
    @property
    def image_url(self) -> str:
        return f"/items/{self.id}/image?variant=original"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def thumbnail_url(self) -> str:
        return f"/items/{self.id}/image?variant=thumbnail"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def palette_card_url(self) -> str | None:
        return f"/items/{self.id}/palette.png" if self.palette else None


SimilarMode = Literal["visual", "palette", "fabric"]


class SimilarItemRead(BaseModel):
    item: ItemRead
    similarity: float | None = Field(
        description="Cosine similarity of the image embeddings (higher = more alike). "
        "Useful for ranking; not a calibrated probability. Null in palette mode."
    )
    palette_distance: float | None = Field(
        default=None,
        description="Palette mode: share-weighted CIEDE2000 distance (lower = closer colours)",
    )
    reasons: list[str] = Field(
        default_factory=list, description="Why this matched, in plain language"
    )


class SimilarResponse(BaseModel):
    item_id: UUID
    mode: SimilarMode
    model: str = Field(description="Embedding model + preprocessing version that was compared")
    results: list[SimilarItemRead]
    compared: int = Field(description="Your other items that were compared")
    not_indexed: int = Field(description="Your other items that could not be compared")
    notice: str | None = Field(
        default=None, description="Why results are limited, e.g. missing tags on this item"
    )


class ItemList(BaseModel):
    items: list[ItemRead]
    total: int
    limit: int
    offset: int
    reasons: dict[str, list[str]] = Field(
        default_factory=dict,
        description="With a text query: why each item on this page matched (keyed by item id)",
    )


ColorFamily = Enum("ColorFamily", {f: f for f in FAMILIES}, type=str)  # type: ignore[misc]


class FamilyCount(BaseModel):
    family: str
    items: int


class TagCount(BaseModel):
    category: str
    tag: str
    items: int


class LibrarySummaryRead(BaseModel):
    total: int
    by_type: dict[str, int]
    by_status: dict[str, int]
    color_families: list[FamilyCount] = Field(description="Most common first")
    tags: list[TagCount] = Field(description="Most common visible tags first")
    collections: int
    recent: list[ItemRead]


class ItemUpdate(BaseModel):
    """PATCH body. Omitted fields are left unchanged; null clears notes / source_url."""

    model_config = ConfigDict(extra="forbid")

    type: ItemType | None = None
    notes: str | None = Field(default=None, max_length=5000)
    source_url: SourceUrl | None = None
