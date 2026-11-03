from typing import Literal

from pydantic import BaseModel

from app.models.enums import Harmony, ItemType, PaletteSource


class PlaygroundColour(BaseModel):
    hex: str
    name: str
    family: str
    percentage: float


class PlaygroundTag(BaseModel):
    """A zero-shot suggestion from the image model, with its relative score."""

    category: str
    tag: str
    score: float
    is_guess: bool


class DemoMatch(BaseModel):
    """A public demo piece; `thumbnail` is relative to /demo/."""

    id: str
    title: str
    type: ItemType
    thumbnail: str
    similarity: float | None = None  # by look: cosine similarity, higher is closer
    distance: float | None = None  # by palette: CIEDE2000 distance, lower is closer


class PlaygroundResult(BaseModel):
    """What Thread measures and suggests for one photo. Nothing about it is kept."""

    width: int
    height: int
    type: ItemType
    # chosen by the visitor, suggested by the model, or "other" when neither is possible
    type_source: Literal["chosen", "suggested", "default"]
    palette: list[PlaygroundColour]
    palette_source: PaletteSource | None
    harmony: Harmony | None  # a rule of thumb about the palette, not a measurement
    # The image model: "ready" (tags and look-alikes below), "loading" (try again shortly)
    # or "unavailable" (palette only).
    model: Literal["ready", "loading", "unavailable"]
    # False when the model is ready but the demo was indexed by a different model, so
    # look-alikes would be meaningless and are left out.
    look_compared: bool
    tags: list[PlaygroundTag]
    similar_look: list[DemoMatch]
    similar_palette: list[DemoMatch]
