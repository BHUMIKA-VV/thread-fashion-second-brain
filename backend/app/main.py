import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app.api.errors import error_body, register_error_handlers
from app.api.routes import (
    admin,
    auth,
    collections,
    deep_analysis,
    dev,
    health,
    items,
    publishing,
    showcase,
    tags,
)
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.session import get_session_factory
from app.ml import registry
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
    # Loads the image model in a daemon thread if its weights exist; never downloads and
    # never delays startup.
    registry.warm_up_in_background()
    yield


UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


async def refuse_cross_site_writes(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Block state-changing requests that a browser sent from another site.

    The session cookie is SameSite=Lax, so most cross-site requests arrive without it
    anyway; this is the second lock. Browsers always send Origin (or Sec-Fetch-Site) on such
    requests; clients that send neither (curl, tests) are not browsers riding a session.
    """
    if request.method in UNSAFE_METHODS:
        origin = request.headers.get("origin")
        cross_site = request.headers.get("sec-fetch-site") == "cross-site"
        if (origin is not None and origin.rstrip("/") not in get_settings().origins) or (
            origin is None and cross_site
        ):
            return JSONResponse(
                status_code=403,
                content=error_body("bad_origin", "This request came from another site."),
            )
    return await call_next(request)


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
    app.middleware("http")(refuse_cross_site_writes)
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(admin.router)
    app.include_router(showcase.router)
    app.include_router(publishing.router)  # before items: /items/showcase-all is literal
    app.include_router(items.router)
    app.include_router(tags.router)
    app.include_router(collections.router)
    app.include_router(deep_analysis.router)
    if settings.app_env != "production" and settings.mail_provider == "log":
        app.include_router(dev.router)
    return app


app = create_app()
