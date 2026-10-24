import logging
import time
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.migrations import head_revision
from app.db.session import get_db
from app.schemas.health import DatabaseHealth, HealthResponse

logger = logging.getLogger(__name__)
router = APIRouter(tags=["health"])


def check_database(db: Session) -> DatabaseHealth:
    started = time.perf_counter()
    try:
        version = db.execute(text("SHOW server_version")).scalar_one()
        pgvector = db.execute(
            text("SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector')")
        ).scalar_one()
    except SQLAlchemyError as exc:
        # Log the cause for developers; never return driver messages to clients.
        logger.warning("Database health check failed: %s", exc.__class__.__name__)
        return DatabaseHealth(status="unavailable")
    latency_ms = round((time.perf_counter() - started) * 1000, 1)

    revision = current_revision(db)
    head = head_revision()
    return DatabaseHealth(
        status="ok",
        server_version=str(version).split(" ")[0],
        pgvector_available=bool(pgvector),
        latency_ms=latency_ms,
        schema_revision=revision,
        schema_head=head,
        schema_up_to_date=revision == head,
    )


def current_revision(db: Session) -> str | None:
    """The applied Alembic revision, or None if migrations have never run."""
    exists = db.execute(
        text("SELECT to_regclass('public.alembic_version') IS NOT NULL")
    ).scalar_one()
    if not exists:
        return None
    return db.execute(text("SELECT version_num FROM alembic_version")).scalar_one_or_none()


@router.get(
    "/health",
    response_model=HealthResponse,
    responses={503: {"model": HealthResponse, "description": "A dependency is unavailable"}},
)
def health(
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> HealthResponse:
    database = check_database(db)
    # An unmigrated (or out-of-date) schema cannot serve requests, so it counts as degraded.
    healthy = database.status == "ok" and bool(database.schema_up_to_date)
    if not healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return HealthResponse(
        status="ok" if healthy else "degraded",
        app=settings.app_name,
        version=settings.app_version,
        environment=settings.app_env,
        database=database,
    )
