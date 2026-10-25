from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.api.deps import CurrentUserId, get_storage
from app.color.card import render_palette_card
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models.enums import ItemType
from app.repositories.errors import NotFoundError
from app.schemas.items import ItemList, ItemRead, ItemUpdate
from app.services.images import ImageValidationError
from app.services.items import ItemService
from app.services.palettes import PaletteService
from app.storage import Storage

router = APIRouter(prefix="/items", tags=["items"])

PRIVATE_FILE_HEADERS = {
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
}

# Multipart framing (boundaries, headers, the "type" field) on top of the file itself.
MULTIPART_OVERHEAD = 64 * 1024
READ_CHUNK = 1024 * 1024


def get_item_service(
    user_id: CurrentUserId,
    db: Annotated[Session, Depends(get_db)],
    storage: Annotated[Storage, Depends(get_storage)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ItemService:
    return ItemService(db, storage, settings, user_id)


Service = Annotated[ItemService, Depends(get_item_service)]


async def read_limited(upload: UploadFile, max_bytes: int) -> bytes:
    """Read at most max_bytes; stop early (without buffering the rest) when exceeded."""
    chunks: list[bytes] = []
    size = 0
    while chunk := await upload.read(READ_CHUNK):
        size += len(chunk)
        if size > max_bytes:
            raise ImageValidationError(
                "too_large", f"The file is larger than {max_bytes // (1024 * 1024)} MB."
            )
        chunks.append(chunk)
    return b"".join(chunks)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=ItemRead,
    responses={
        409: {"description": "Duplicate: details.existing_item_id names the existing item"},
        413: {"description": "File too large"},
        415: {"description": "Not a JPEG, PNG or WebP image"},
        422: {"description": "Damaged image or dimensions out of range"},
    },
)
async def upload_item(
    request: Request,
    response: Response,
    service: Service,
    settings: Annotated[Settings, Depends(get_settings)],
    file: Annotated[UploadFile, File(description="JPEG, PNG or WebP image")],
    type: Annotated[ItemType, Form()] = ItemType.OTHER,  # noqa: A002 (API field name)
) -> ItemRead:
    """Upload one image. Returns at once; analysis status starts as `queued`."""
    declared = request.headers.get("content-length")
    if (
        declared
        and declared.isdigit()
        and int(declared) > settings.max_upload_bytes + MULTIPART_OVERHEAD
    ):
        raise ImageValidationError(
            "too_large", f"The file is larger than {settings.max_upload_bytes // (1024 * 1024)} MB."
        )
    data = await read_limited(file, settings.max_upload_bytes)
    # Decoding, re-encoding and the DB write are blocking: keep them off the event loop.
    item = await run_in_threadpool(service.upload, data, type)
    response.headers["Location"] = f"/items/{item.id}"
    return ItemRead.model_validate(item)


@router.get("", response_model=ItemList)
def list_items(
    service: Service,
    type: Annotated[ItemType | None, Query()] = None,  # noqa: A002
    limit: Annotated[int, Query(ge=1, le=100)] = 48,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ItemList:
    item_type = type.value if type else None
    rows = service.items.list(item_type=item_type, limit=limit, offset=offset)
    return ItemList(
        items=[ItemRead.model_validate(row) for row in rows],
        total=service.items.count(item_type=item_type),
        limit=limit,
        offset=offset,
    )


@router.get("/{item_id}", response_model=ItemRead)
def get_item(item_id: UUID, service: Service) -> ItemRead:
    return ItemRead.model_validate(service.items.get_or_raise(item_id))


@router.patch("/{item_id}", response_model=ItemRead)
def update_item(item_id: UUID, body: ItemUpdate, service: Service) -> ItemRead:
    changes = body.model_dump(exclude_unset=True)
    if changes.get("type") is None:
        changes.pop("type", None)  # type cannot be cleared, only changed
    else:
        changes["type"] = changes["type"].value
    if changes.get("source_url") is not None:
        changes["source_url"] = str(changes["source_url"])
    item = service.items.update(item_id, **changes)
    service.db.commit()
    return ItemRead.model_validate(item)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(item_id: UUID, service: Service) -> Response:
    service.delete(item_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/{item_id}/image",
    response_class=Response,
    responses={200: {"content": {"image/jpeg": {}, "image/png": {}, "image/webp": {}}}},
)
def get_item_image(
    item_id: UUID,
    service: Service,
    variant: Annotated[Literal["original", "thumbnail"], Query()] = "thumbnail",
) -> Response:
    """Serve a stored image after an ownership check. Only named variants exist: there is no
    way to address an arbitrary storage path."""
    data, mime_type = service.read_image(item_id, variant)
    return Response(content=data, media_type=mime_type, headers=PRIVATE_FILE_HEADERS)


@router.post(
    "/{item_id}/palette",
    response_model=ItemRead,
    responses={422: {"description": "Extraction failed (code palette_failed); nothing invented"}},
)
def extract_item_palette(
    item_id: UUID,
    service: Service,
    colors: Annotated[int | None, Query(ge=1, le=12, description="Colours to extract")] = None,
) -> ItemRead:
    """(Re-)extract the colour palette from the stored image. Replaces any earlier palette."""
    item = service.items.get_or_raise(item_id)
    PaletteService(service.db, service.storage, service.settings, service.owner_id).extract(
        item, n_colors=colors
    )
    return ItemRead.model_validate(item)


@router.get(
    "/{item_id}/palette.png",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}, 404: {"description": "No palette yet"}},
)
def get_palette_card(item_id: UUID, service: Service) -> Response:
    """The item's palette as a downloadable 1200x675 PNG card."""
    item = service.items.get_or_raise(item_id)
    if item.palette is None or not item.palette.colors:
        raise NotFoundError("This item has no palette yet.")
    return Response(
        content=render_palette_card(item.palette.colors),
        media_type="image/png",
        headers={
            **PRIVATE_FILE_HEADERS,
            "Content-Disposition": f'attachment; filename="thread-palette-{item.id}.png"',
        },
    )
