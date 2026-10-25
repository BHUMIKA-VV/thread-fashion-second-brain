"""Palette extraction for stored items.

Runs in-process for now (a few hundred milliseconds at most on a 256 px downsample). When
the background worker arrives, the same `extract` call becomes one of its stages.

Failure policy: a failed extraction never produces a made-up palette. The item records
`stage_status["palette"] = "failed"` with a user-safe message; a palette extracted earlier
from the same image is kept rather than discarded.
"""

import io
import logging
from uuid import UUID

from PIL import Image
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.color.harmony import detect_harmony
from app.color.palette import extract_palette
from app.core.config import Settings
from app.models import Item, Palette
from app.models.enums import ItemType
from app.services.status import set_stage
from app.storage import Storage

logger = logging.getLogger(__name__)

PALETTE_FAILED_MESSAGE = "The colour palette could not be extracted from this image."


class PaletteExtractionError(Exception):
    """Extraction failed; the item has been marked accordingly."""


class PaletteService:
    def __init__(self, db: Session, storage: Storage, settings: Settings, owner_id: UUID) -> None:
        self.db = db
        self.storage = storage
        self.settings = settings
        self.owner_id = owner_id

    def extract(
        self, item: Item, *, n_colors: int | None = None, image_bytes: bytes | None = None
    ) -> Palette:
        """Extract, store and return the palette for `item` (already ownership-checked).

        Commits either the new palette or the failure state. Raises PaletteExtractionError
        on failure.
        """
        try:
            data = image_bytes if image_bytes is not None else self.storage.read(item.original_key)
            with Image.open(io.BytesIO(data)) as image:
                result = extract_palette(
                    image,
                    n_colors or self.settings.palette_size,
                    # A fabric swatch fills the frame: its "border" is the fabric itself.
                    detect_background=item.type != ItemType.FABRIC,
                )
        except Exception as exc:
            logger.exception("Palette extraction failed for item %s", item.id)
            set_stage(item, "palette", "failed")
            item.processing_error = PALETTE_FAILED_MESSAGE
            self.db.commit()
            raise PaletteExtractionError(PALETTE_FAILED_MESSAGE) from exc

        colors = [
            {
                "hex": c.hex,
                "rgb": list(c.rgb),
                "name": c.name,
                "family": c.family,
                "percentage": c.percentage,
                "lab": list(c.lab),
            }
            for c in result.colors
        ]
        values = {
            "item_id": item.id,
            "colors": colors,
            "harmony": detect_harmony([(c.lab, c.percentage) for c in result.colors]).value,
            "color_families": sorted({c.family for c in result.colors}),
            "source": result.source,
        }
        # Upsert: re-extraction replaces the row instead of creating a duplicate.
        self.db.execute(
            insert(Palette)
            .values(**values)
            .on_conflict_do_update(
                index_elements=[Palette.item_id],
                set_={k: v for k, v in values.items() if k != "item_id"}
                | {"updated_at": func.clock_timestamp()},
            )
        )
        set_stage(item, "palette", "completed")
        if item.processing_error == PALETTE_FAILED_MESSAGE:
            item.processing_error = None
        self.db.commit()
        # The upsert bypassed the ORM, so reload the relationship from the database.
        self.db.expire(item, ["palette"])
        palette = item.palette
        if palette is None:  # pragma: no cover - the row was just written
            raise PaletteExtractionError(PALETTE_FAILED_MESSAGE)
        return palette
