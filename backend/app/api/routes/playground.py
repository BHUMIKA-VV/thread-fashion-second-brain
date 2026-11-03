"""The public playground: try Thread on one photo, with no account. See
app/services/playground.py for what is and isn't done with the photo."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.concurrency import run_in_threadpool

from app.api.deps import ClientIp
from app.core.config import Settings, get_settings
from app.models.enums import ItemType
from app.schemas.playground import PlaygroundResult
from app.services.images import ImageValidationError
from app.services.playground import PlaygroundService, limits

router = APIRouter(prefix="/playground", tags=["playground"])


def get_playground_service(
    settings: Annotated[Settings, Depends(get_settings)],
) -> PlaygroundService:
    return PlaygroundService(settings)


async def read_body(request: Request, max_bytes: int) -> bytes:
    """The raw request body, in memory, stopping as soon as it is too large. (A multipart form
    would be spooled to a temporary file once it passes 1 MB; this never touches the disk.)"""
    too_large = ImageValidationError(
        "too_large", f"The file is larger than {max_bytes // (1024 * 1024)} MB."
    )
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > max_bytes:
        raise too_large
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > max_bytes:
            raise too_large
    return bytes(body)


@router.post(
    "/analyse",
    response_model=PlaygroundResult,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                media: {"schema": {"type": "string", "format": "binary"}}
                for media in ("image/jpeg", "image/png", "image/webp")
            },
        }
    },
    responses={
        413: {"description": "File too large"},
        415: {"description": "Not a JPEG, PNG or WebP image"},
        422: {"description": "Damaged image or dimensions out of range"},
        429: {"description": "Too many photos from this network, or for today"},
        503: {"description": "busy: other photos are being analysed; retry after Retry-After"},
    },
)
async def analyse(
    request: Request,
    response: Response,
    ip: ClientIp,
    settings: Annotated[Settings, Depends(get_settings)],
    service: Annotated[PlaygroundService, Depends(get_playground_service)],
    type: Annotated[ItemType | None, Query()] = None,  # noqa: A002 (API field name)
) -> PlaygroundResult:
    """Analyse one photo (the request body: JPEG, PNG or WebP bytes) in memory and compare it
    with the public demo. Nothing is stored. The format is read from the bytes, never from
    Content-Type."""
    service.check_limits(ip)
    data = await read_body(request, limits(settings).max_bytes)
    result = await run_in_threadpool(service.analyse, data, type)
    response.headers["Cache-Control"] = "no-store"
    return result
