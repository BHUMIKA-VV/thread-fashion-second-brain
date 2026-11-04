from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.models.enums import Harmony
from app.schemas.items import ItemRead
from app.schemas.outfits import OutfitColoursRead

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
Body = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
Hex = Annotated[
    str, StringConstraints(strip_whitespace=True, to_lower=True, pattern=r"^#[0-9a-fA-F]{6}$")
]
Kind = Literal["piece", "colour", "heading", "note"]

HEADING_LENGTH = 200


class BoardCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    description: Description | None = None
    from_collection_id: UUID | None = Field(
        default=None,
        description="Start the board with this collection's pieces, in order, notes as captions",
    )


class BoardUpdate(BaseModel):
    """Omitted fields are unchanged; description null clears it."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    description: Description | None = None


def _check_heading(kind: str, body: str | None) -> None:
    if kind == "heading" and body is not None and len(body) > HEADING_LENGTH:
        raise ValueError(f"A heading can be up to {HEADING_LENGTH} characters.")


class BlockAdd(BaseModel):
    """A piece needs item_id, a colour needs hex, a heading or a note needs body. A piece or a
    colour may carry a caption in body. Without position the block goes at the end."""

    model_config = ConfigDict(extra="forbid")

    kind: Kind
    item_id: UUID | None = None
    hex: Hex | None = None
    body: Body | None = None
    position: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _shape(self) -> Self:
        if (self.kind == "piece") != (self.item_id is not None):
            raise ValueError("item_id is given for a piece, and only for a piece.")
        if (self.kind == "colour") != (self.hex is not None):
            raise ValueError("hex is given for a colour, and only for a colour.")
        if self.kind in ("heading", "note") and not self.body:
            raise ValueError(f"A {self.kind} needs text.")
        _check_heading(self.kind, self.body)
        return self


class BlockUpdate(BaseModel):
    """Edit the text or the colour, and/or move the block (0-based position). body null clears
    a caption; a heading or a note keeps its text."""

    model_config = ConfigDict(extra="forbid")

    body: Body | None = None
    hex: Hex | None = None
    position: int | None = Field(default=None, ge=0)


class BlockColour(BaseModel):
    hex: str
    name: str = Field(description="Thread's nearest colour name")
    family: str


class BlockRead(BaseModel):
    id: UUID
    kind: Kind
    position: int
    item: ItemRead | None
    colour: BlockColour | None
    body: str | None
    created_at: datetime


class NearestSwatchRead(BaseModel):
    hex: str
    name: str
    item_id: UUID
    distance: float = Field(description="CIEDE2000 distance from the chosen colour")


class ChosenColourRead(BaseModel):
    block_id: UUID
    hex: str
    name: str
    family: str
    nearest: NearestSwatchRead | None = Field(
        description="The closest colour measured on the board's pieces, if it has any"
    )
    on_pieces: bool = Field(description="Whether that colour is close enough to count as the same")


class ColourStoryRead(BaseModel):
    """Calculated from the pieces' stored palettes and the colours chosen; never by a model."""

    measured: OutfitColoursRead
    chosen: list[ChosenColourRead]
    harmony: Harmony | None


class BoardSummary(BaseModel):
    id: UUID
    name: str
    description: str | None
    block_count: int
    cover_thumbnails: list[str] = Field(
        description="API-relative thumbnail URLs of the first 4 pieces"
    )
    created_at: datetime
    updated_at: datetime


class BoardDetail(BaseModel):
    id: UUID
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime
    blocks: list[BlockRead]
    colour_story: ColourStoryRead
