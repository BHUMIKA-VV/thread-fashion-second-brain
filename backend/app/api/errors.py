"""Consistent JSON error bodies: {"error": {"code": ..., "message": ..., "details": ...}}."""

import logging

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.repositories.errors import ConflictError, NotFoundError
from app.services.images import ImageValidationError

IMAGE_ERROR_STATUS = {
    "too_large": status.HTTP_413_CONTENT_TOO_LARGE,
    "unsupported_format": status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
    "invalid_image": status.HTTP_422_UNPROCESSABLE_CONTENT,
    "bad_dimensions": status.HTTP_422_UNPROCESSABLE_CONTENT,
}

logger = logging.getLogger(__name__)


def error_body(code: str, message: str, details: object | None = None) -> dict[str, object]:
    return {"error": {"code": code, "message": message, "details": details}}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = exc.detail if isinstance(exc.detail, str) else "http_error"
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(code.lower().replace(" ", "_"), str(exc.detail)),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = [
            {"loc": list(err["loc"]), "message": err["msg"], "type": err["type"]}
            for err in exc.errors()
        ]
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content=error_body("validation_error", "Request validation failed", details),
        )

    @app.exception_handler(NotFoundError)
    async def not_found(_: Request, exc: NotFoundError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND, content=error_body("not_found", str(exc))
        )

    @app.exception_handler(ConflictError)
    async def conflict(_: Request, exc: ConflictError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content=error_body("conflict", str(exc), exc.details),
        )

    @app.exception_handler(ImageValidationError)
    async def invalid_image(_: Request, exc: ImageValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=IMAGE_ERROR_STATUS.get(exc.code, 422),
            content=error_body(exc.code, str(exc)),
        )

    @app.exception_handler(Exception)
    async def unhandled_error(request: Request, exc: Exception) -> JSONResponse:
        # Full traceback goes to the server log only; clients get a generic message.
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=error_body("internal_error", "Something went wrong. Please try again."),
        )
