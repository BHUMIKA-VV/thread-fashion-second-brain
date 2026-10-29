"""Deep analysis: optional, user-triggered Claude vision description of one piece."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, status
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import CurrentUserId, get_storage
from app.core.config import Settings, get_settings
from app.db.session import get_db, get_session_factory
from app.ml.deep_analyzer import (
    NOT_SENT,
    SENT_DATA,
    DeepAnalyzer,
    build_analyzer,
    unavailable_reason,
)
from app.models import DeepAnalysis
from app.schemas.deep_analysis import (
    DeepAnalysisErrorRead,
    DeepAnalysisRead,
    DeepAnalysisStatusRead,
    DeepAnalyzeRequest,
    TokenUsage,
)
from app.services.deep_analysis import DeepAnalysisService, run_deep_analysis, stored_result
from app.storage import Storage

router = APIRouter(tags=["deep analysis"])


def get_deep_analyzer(settings: Annotated[Settings, Depends(get_settings)]) -> DeepAnalyzer | None:
    return build_analyzer(settings)


def get_background_sessions() -> sessionmaker[Session]:
    """Sessions for the run after the response (the request's session is closed by then)."""
    return get_session_factory()


def get_service(
    user_id: CurrentUserId,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
    analyzer: Annotated[DeepAnalyzer | None, Depends(get_deep_analyzer)],
) -> DeepAnalysisService:
    return DeepAnalysisService(db, settings, user_id, analyzer)


Service = Annotated[DeepAnalysisService, Depends(get_service)]


def to_read(item_id: UUID, row: DeepAnalysis | None) -> DeepAnalysisRead:
    if row is None:
        return DeepAnalysisRead(item_id=item_id, status="not_run")
    result = stored_result(row)
    failed = row.status == "failed" and row.error_code is not None
    return DeepAnalysisRead(
        item_id=item_id,
        status=row.status,  # type: ignore[arg-type]
        requested_model=row.requested_model,
        started_at=row.started_at,
        finished_at=row.finished_at,
        error=DeepAnalysisErrorRead(
            code=row.error_code or "",
            message=row.error_message or "",
            retry_after_seconds=row.retry_after_seconds,
        )
        if failed
        else None,
        result=result,
        result_model=row.result_model if result else None,
        result_at=row.result_at if result else None,
        prompt_version=row.result_prompt_version if result else None,
        usage=TokenUsage(input_tokens=row.input_tokens, output_tokens=row.output_tokens)
        if result
        else None,
    )


@router.get("/deep-analysis/status", response_model=DeepAnalysisStatusRead)
def deep_analysis_status(service: Service) -> DeepAnalysisStatusRead:
    """Whether deep analysis can run, which model it uses, today's usage and what is sent.
    Never includes the key or the base URL."""
    settings = service.settings
    analyzer = service.analyzer
    return DeepAnalysisStatusRead(
        available=analyzer is not None,
        reason=unavailable_reason(settings),  # type: ignore[arg-type]
        provider=analyzer.provider if analyzer else None,  # type: ignore[arg-type]
        model=analyzer.model if analyzer else None,
        effort=settings.deep_analysis_effort
        if analyzer and analyzer.provider == "claude"
        else None,
        daily_limit=settings.deep_analysis_daily_limit,
        runs_today=service.runs_today(),
        sent=list(SENT_DATA),
        not_sent=list(NOT_SENT),
    )


@router.get("/items/{item_id}/deep-analysis", response_model=DeepAnalysisRead)
def get_deep_analysis(item_id: UUID, service: Service) -> DeepAnalysisRead:
    """The latest attempt and the last successful result (status "not_run" if none)."""
    return to_read(item_id, service.get(item_id))


@router.post(
    "/items/{item_id}/deep-analyze",
    response_model=DeepAnalysisRead,
    status_code=status.HTTP_202_ACCEPTED,
    responses={
        409: {"description": "Already running for this piece (code already_running)"},
        429: {"description": "Two runs in flight (busy) or the daily limit was reached"},
        503: {"description": "Deep analysis is not configured (deep_analysis_unavailable)"},
    },
)
def start_deep_analysis(
    item_id: UUID,
    body: DeepAnalyzeRequest,  # validated: `confirm` must be true
    service: Service,
    background: BackgroundTasks,
    storage: Annotated[Storage, Depends(get_storage)],
    sessions: Annotated[sessionmaker[Session], Depends(get_background_sessions)],
) -> DeepAnalysisRead:
    """Send this piece's image (and its palette names and visible tags) to Claude.

    Answers at once with status "running"; poll GET /items/{id}/deep-analysis. Uploads,
    palettes, tags and similarity never depend on this."""
    del body
    claim = service.start(item_id)
    analyzer = service.analyzer
    assert analyzer is not None  # noqa: S101 (start() raised otherwise)
    background.add_task(run_deep_analysis, sessions, storage, service.settings, analyzer, claim)
    return to_read(item_id, service.get(item_id))
