from fastapi import FastAPI

from app.api.errors import register_error_handlers
from app.api.routes import health
from app.core.config import get_settings
from app.core.logging import configure_logging


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="Personal fashion inspiration library: palettes, tags and visual search.",
    )
    register_error_handlers(app)
    app.include_router(health.router)
    return app


app = create_app()
