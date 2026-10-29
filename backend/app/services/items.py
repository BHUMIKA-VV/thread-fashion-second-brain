"""Item use-cases that span the database and file storage.

Consistency rules (the database is the source of truth):
- Upload: write files first, then insert + commit the row. If anything after the first file
  write fails, the files written so far are deleted, so no row ever points at a missing file.
  A crash between the file write and the commit can leave unreferenced files (never a broken
  row); they are harmless and could be swept by a maintenance job later.
- Delete: commit the row deletion first, then delete files best-effort. A failed file delete
  leaves an unreferenced file, never a row whose image is gone.
"""

import contextlib
import hashlib
import logging
import uuid
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.ml import registry
from app.models import Item
from app.models.enums import ItemType
from app.repositories.errors import ConflictError, NotFoundError
from app.repositories.items import ItemRepository
from app.services.auth import AuthRefused
from app.services.embeddings import EmbeddingFailed, EmbeddingService
from app.services.images import ImageLimits, process_upload
from app.services.palettes import PaletteExtractionError, PaletteService
from app.storage import Storage, item_key
from app.storage.base import ObjectNotFoundError

logger = logging.getLogger(__name__)

IMAGE_VARIANTS = ("original", "thumbnail")


def limits_from(settings: Settings) -> ImageLimits:
    return ImageLimits(
        max_bytes=settings.max_upload_bytes,
        max_side=settings.max_image_side,
        min_side=settings.min_image_side,
        max_pixels=settings.max_image_pixels,
    )


class ItemService:
    def __init__(self, db: Session, storage: Storage, settings: Settings, owner_id: UUID) -> None:
        self.db = db
        self.storage = storage
        self.settings = settings
        self.owner_id = owner_id
        self.items = ItemRepository(db, owner_id)

    def check_quota(self, incoming_bytes: int) -> None:
        """Refuse an upload that would take the account past its piece or storage quota."""
        count, used = self.db.execute(
            select(func.count(), func.coalesce(func.sum(Item.file_size), 0)).where(
                Item.user_id == self.owner_id
            )
        ).one()
        if count >= self.settings.quota_items:
            raise AuthRefused(
                "quota_exceeded",
                f"Your archive is full ({self.settings.quota_items} pieces). "
                "Delete a piece to add another.",
                403,
            )
        if used + incoming_bytes > self.settings.quota_bytes:
            gib = self.settings.quota_bytes / 1024**3
            raise AuthRefused(
                "quota_exceeded",
                f"Your archive has reached its {gib:g} GB storage limit. "
                "Delete a piece to add another.",
                403,
            )

    def upload(self, data: bytes, item_type: ItemType = ItemType.OTHER) -> Item:
        # Hash the bytes exactly as received, so re-uploading the same file is detected.
        content_hash = hashlib.sha256(data).hexdigest()
        existing = self.items.find_by_hash(content_hash)
        if existing is not None:
            raise ConflictError(
                "This image is already in your library.",
                {"existing_item_id": str(existing.id)},
            )

        image = process_upload(data, limits_from(self.settings), self.settings.thumbnail_side)

        item_id = uuid.uuid4()
        original_key = item_key(self.owner_id, item_id, f"original.{image.extension}")
        thumbnail_key = item_key(self.owner_id, item_id, "thumbnail.webp")

        written: list[str] = []
        try:
            for key, payload in ((original_key, image.original), (thumbnail_key, image.thumbnail)):
                self.storage.save(key, payload)
                written.append(key)
            item = self.items.create(
                id=item_id,
                type=item_type.value,
                original_key=original_key,
                thumbnail_key=thumbnail_key,
                content_hash=content_hash,
                mime_type=image.mime_type,
                width=image.width,
                height=image.height,
                file_size=len(image.original),
                # Tags and embeddings come in later milestones, so the item stays "queued";
                # per-stage outcomes are tracked in stage_status.
                stage_status={"thumbnail": "completed"},
            )
            self.db.commit()
        except BaseException:
            self.db.rollback()
            self._remove_files(written)
            raise
        logger.info("Stored item %s (%s, %dx%d)", item.id, image.format, image.width, image.height)

        # The upload is already safely stored; palette extraction is best-effort on top of it.
        # A failure is recorded on the item (stage_status + processing_error); retry via the API.
        with contextlib.suppress(PaletteExtractionError):
            PaletteService(self.db, self.storage, self.settings, self.owner_id).extract(
                item, image_bytes=image.original
            )

        # Similarity indexing is also best-effort and never waits for a model load.
        try:
            EmbeddingService(self.db, self.storage, self.owner_id).index_after_upload(
                item, image.original
            )
        except Exception:
            logger.exception("Unexpected error while indexing item %s", item.id)
            self.db.rollback()
        return item

    def reanalyze(self, item_id: UUID) -> Item:
        """Palette, embedding and AI tags again, from the stored original. Never raises for
        analysis failures (they are recorded per stage) and never waits for the image model."""
        item = self.items.get_or_raise(item_id)
        with contextlib.suppress(PaletteExtractionError):
            PaletteService(self.db, self.storage, self.settings, self.owner_id).extract(item)
        embeddings = EmbeddingService(self.db, self.storage, self.owner_id)
        embedder = registry.get_embedder_if_ready()
        if embedder is None:
            embeddings.mark_waiting_for_model(item)
        else:
            with contextlib.suppress(EmbeddingFailed):
                embeddings.index(item, embedder)
        self.db.refresh(item)
        return item

    def delete(self, item_id: UUID) -> None:
        item = self.items.delete(item_id)
        keys = [k for k in (item.original_key, item.thumbnail_key, item.cutout_key) if k]
        self.db.commit()
        self._remove_files(keys)

    def read_image(self, item_id: UUID, variant: str) -> tuple[bytes, str]:
        """Bytes and MIME type of one stored variant of an item the owner can see."""
        item = self.items.get_or_raise(item_id)
        if variant == "original":
            key, mime_type = item.original_key, item.mime_type
        else:
            key, mime_type = item.thumbnail_key, "image/webp"
        if key is None:
            raise NotFoundError("Image not available.")
        try:
            return self.storage.read(key), mime_type
        except ObjectNotFoundError as exc:
            logger.error("Item %s references a missing %s file", item_id, variant)
            raise NotFoundError("Image not available.") from exc

    def _remove_files(self, keys: list[str]) -> None:
        for key in keys:
            try:
                self.storage.delete(key)
            except Exception:  # cleanup must not mask the original error
                logger.exception("Could not remove stored file during cleanup")
