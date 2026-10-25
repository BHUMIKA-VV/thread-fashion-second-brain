"""Derive an item's overall processing_status from the analysis stages that exist today.

Stages: palette and embedding (tags will join in a later milestone). Each stage outcome is
"completed", "failed", "unavailable" (no model installed) or "pending" (waiting for the model).
"""

from app.models import Item
from app.models.enums import ProcessingStatus

ANALYSIS_STAGES = ("palette", "embedding")


def derive_status(stage_status: dict[str, str]) -> ProcessingStatus:
    outcomes = [stage_status.get(stage) for stage in ANALYSIS_STAGES]
    if any(outcome in (None, "pending") for outcome in outcomes):
        return ProcessingStatus.QUEUED
    if all(outcome == "completed" for outcome in outcomes):
        return ProcessingStatus.COMPLETED
    if any(outcome == "completed" for outcome in outcomes):
        return ProcessingStatus.PARTIALLY_COMPLETED
    return ProcessingStatus.FAILED


def set_stage(item: Item, stage: str, outcome: str) -> None:
    """Record one stage's outcome and update the overall status to match."""
    # Assign a new dict: in-place JSONB mutation is not tracked by SQLAlchemy.
    item.stage_status = {**(item.stage_status or {}), stage: outcome}
    item.processing_status = derive_status(item.stage_status).value
