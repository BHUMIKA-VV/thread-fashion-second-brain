from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import ItemType, TagCategory


class TagRead(BaseModel):
    category: TagCategory
    tag: str
    source: Literal["ai", "user"]
    score: float | None = Field(
        description="AI model score: softmax within the category. Relative and uncalibrated, "
        "not a probability. Null for tags you added."
    )
    custom: bool = Field(description="A tag you added that is not in the controlled vocabulary")
    outdated: bool = Field(description="AI tag from an older model / prompt / vocabulary version")
    is_guess: bool = Field(description="True for fabric: guessed from a photo, not measured")


class ItemTags(BaseModel):
    item_id: UUID
    status: Literal["completed", "pending", "unavailable", "failed"]
    version: str | None = Field(description="Tagger version (model, prompts, vocabulary)")
    suggested_type: ItemType | None
    tags: list[TagRead]
    removed: list[TagRead] = Field(description="AI tags you removed (can be restored)")


class TagEditIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: TagCategory
    tag: str = Field(min_length=1, max_length=80)


class TagEditRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    add: list[TagEditIn] = Field(default_factory=list, max_length=20)
    remove: list[TagEditIn] = Field(default_factory=list, max_length=20)


class LabelScoreRead(BaseModel):
    tag: str
    score: float
    none: bool = Field(description="A 'none of these' option: never stored as a tag")
    passes: bool = Field(description="Clears the thresholds, so it is stored as an AI tag")


class CategoryScores(BaseModel):
    category: TagCategory
    is_guess: bool
    min_score: float
    min_margin: float
    max_tags: int
    labels: list[LabelScoreRead]


class TagScores(BaseModel):
    item_id: UUID
    version: str
    note: str = (
        "Scores are a softmax within each category: relative and uncalibrated, not "
        "probabilities. Thresholds were set conservatively, not fitted to labelled data."
    )
    categories: list[CategoryScores]


class VocabularyCategory(BaseModel):
    category: TagCategory
    is_guess: bool
    max_tags: int
    tags: list[str]


class Vocabulary(BaseModel):
    version: str
    categories: list[VocabularyCategory]
