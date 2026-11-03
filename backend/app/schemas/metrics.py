from datetime import date
from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

from app.models.enums import MetricEvent


class ViewCreate(BaseModel):
    """One visit seeing a public page, as the page's beacon sends it."""

    model_config = ConfigDict(extra="forbid")

    event: MetricEvent
    # The host the visit came from (document.referrer's host). Only its category is kept.
    referrer: Annotated[str | None, StringConstraints(max_length=255)] = None
    # A campaign tag from ?ref=, e.g. "insta-nov". Kept only if it is a short lowercase slug.
    ref: Annotated[str | None, StringConstraints(max_length=64)] = None


class SourceCounts(BaseModel):
    source: str
    total: int
    events: dict[MetricEvent, int]


class Funnel(BaseModel):
    """From the app's own tables, over the same days: no tracking needed for these."""

    signups: int
    confirmed: int
    added_a_piece: int
    wardrobe_interest: int
    studio_interest: int


class MetricsSummary(BaseModel):
    days: int
    since: date
    events: dict[MetricEvent, int]
    sources: list[SourceCounts]
    funnel: Funnel
