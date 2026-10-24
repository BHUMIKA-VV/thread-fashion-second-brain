import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy.exc import SQLAlchemyError

from app.api.errors import register_error_handlers
from app.api.routes import health
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.session import get_session_factory
from app.repositories.users import ensure_user

logger = logging.getLogger(__name__)


def ensure_dev_user() -> None:
    """Create the development user if the database is reachable and migrated."""
    settings = get_settings()
    if settings.app_env == "production":
        return
    try:
        with get_session_factory()() as db, db.begin():
            ensure_user(db, settings.dev_user_id, settings.dev_user_name)
    except SQLAlchemyError as exc:
        # Startup must not fail just because Postgres is down or not migrated yet;
        # /health reports both conditions.
        logger.warning(
            "Could not ensure development user (%s). Is the database up and migrated "
            "(alembic upgrade head)?",
            exc.__class__.__name__,
        )


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    ensure_dev_user()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="Personal fashion inspiration library: palettes, tags and visual search.",
        lifespan=lifespan,
    )
    register_error_handlers(app)
    app.include_router(health.router)
    return app


app = create_app()
