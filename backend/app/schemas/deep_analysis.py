from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.ml.deep_analyzer import DeepAnalysisResult


class DeepAnalyzeRequest(BaseModel):
    """The UI sends this only after the user confirmed what will be sent."""

    model_config = ConfigDict(extra="forbid")

    confirm: Literal[True]


class DeepAnalysisStatusRead(BaseModel):
    available: bool
    reason: Literal["not_configured", "disabled_in_production"] | None
    provider: Literal["claude", "fake"] | None
    model: str | None
    effort: str | None
    daily_limit: int
    runs_today: int
    sent: list[str]  # what each run transmits (shown before confirming)
    not_sent: list[str]


class DeepAnalysisErrorRead(BaseModel):
    code: str
    message: str
    retry_after_seconds: int | None


class TokenUsage(BaseModel):
    input_tokens: int | None
    output_tokens: int | None


class DeepAnalysisRead(BaseModel):
    item_id: UUID
    status: Literal["not_run", "running", "completed", "failed"]
    requested_model: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: DeepAnalysisErrorRead | None = None  # the latest attempt's, if it failed
    # The last successful result, kept when a later attempt fails.
    result: DeepAnalysisResult | None = None
    result_model: str | None = None  # the model that actually answered
    result_at: datetime | None = None
    prompt_version: str | None = None
    usage: TokenUsage | None = None
