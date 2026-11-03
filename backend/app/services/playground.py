"""The public playground: one visitor's photo, analysed in memory and compared with the demo.

Nothing about the photo is kept. It is validated exactly as an upload is, measured by the same
code (palette, harmony) and, when the image model is loaded, embedded and tagged as an upload
would be. Look-alikes and palette matches come only from the public demo pieces, whose vectors
and palettes scripts/build_demo.py writes to app/playground/demo_index.json. No file is written,
no database is touched, and the image is never logged.

Abuse limits, in this process's memory (see rate_limit.py): PER_IP_PER_HOUR analyses per network
address, DAILY_CAP for everyone together, and at most CONCURRENT at once; beyond that the
visitor is asked to try again in a moment.
"""

import json
import threading
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from app.color.compare import palette_distance
from app.color.harmony import detect_harmony
from app.color.palette import PaletteError, extract_palette
from app.core.config import Settings
from app.ml import registry, vocabulary
from app.models.enums import ItemType
from app.schemas.playground import DemoMatch, PlaygroundColour, PlaygroundResult, PlaygroundTag
from app.services.auth import AuthRefused
from app.services.images import ImageLimits, decode_for_analysis
from app.services.rate_limit import RateLimited, limiter

INDEX_PATH = Path(__file__).resolve().parents[1] / "playground" / "demo_index.json"

MAX_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 12_000_000
PER_IP_PER_HOUR = 10
DAILY_CAP = 300
CONCURRENT = 2
SIMILAR = 6

_slots = threading.BoundedSemaphore(CONCURRENT)


@dataclass(frozen=True)
class DemoPiece:
    id: str
    title: str
    type: ItemType
    thumbnail: str
    palette: list[dict[str, Any]]
    vector: np.ndarray | None


@dataclass(frozen=True)
class DemoIndex:
    model: str | None
    pieces: list[DemoPiece]


@lru_cache(maxsize=1)
def demo_index(path: Path = INDEX_PATH) -> DemoIndex:
    data = json.loads(path.read_text(encoding="utf-8"))
    pieces = []
    for p in data["pieces"]:
        vector = None
        if p.get("vector"):
            raw = np.asarray(p["vector"], dtype=np.float32)
            vector = raw / np.linalg.norm(raw)  # undo the rounding's tiny change in length
        pieces.append(
            DemoPiece(
                p["id"], p["title"], ItemType(p["type"]), p["thumbnail"], p["palette"], vector
            )
        )
    return DemoIndex(data.get("model"), pieces)


def limits(settings: Settings) -> ImageLimits:
    """Stricter than uploads: a smaller file and fewer pixels, so an analysis stays cheap."""
    return ImageLimits(
        max_bytes=min(MAX_BYTES, settings.max_upload_bytes),
        max_side=settings.max_image_side,
        min_side=settings.min_image_side,
        max_pixels=min(MAX_PIXELS, settings.max_image_pixels),
    )


def _match(piece: DemoPiece, **score: float) -> DemoMatch:
    return DemoMatch(
        id=piece.id, title=piece.title, type=piece.type, thumbnail=piece.thumbnail, **score
    )


class PlaygroundService:
    def __init__(self, settings: Settings, index: DemoIndex | None = None) -> None:
        self.settings = settings
        self.index = index or demo_index()

    def check_limits(self, ip: str) -> None:
        """Count this attempt against the network's and everyone's allowance."""
        try:
            limiter.hit(f"playground-ip:{ip}", PER_IP_PER_HOUR, 3600)
            limiter.hit("playground-day", DAILY_CAP, 86400)
        except RateLimited as exc:
            raise AuthRefused(
                "rate_limited",
                "The playground has had a lot of photos for now. Try again later.",
                429,
                exc.retry_after,
            ) from exc

    def analyse(self, data: bytes, item_type: ItemType | None) -> PlaygroundResult:
        if not _slots.acquire(blocking=False):
            raise AuthRefused(
                "busy", "The playground is busy with other photos. Try again in a moment.", 503, 5
            )
        try:
            image = decode_for_analysis(data, limits(self.settings))
            return self._analyse(image, item_type)
        finally:
            _slots.release()

    def _analyse(self, image: Image.Image, chosen: ItemType | None) -> PlaygroundResult:
        embedder = registry.get_embedder_if_ready()
        tagger = registry.get_tagger_if_ready()
        if embedder is None or tagger is None or tagger.model_name != embedder.model_name:
            embedder, tagger, model = None, None, self._model_state()
        else:
            model = "ready"

        vector = embedder.embed(image) if embedder is not None else None
        suggested = (
            tagger.suggest_type(vector) if tagger is not None and vector is not None else None
        )
        item_type = chosen or suggested or ItemType.OTHER
        type_source = "chosen" if chosen else "suggested" if suggested else "default"

        try:
            result = extract_palette(
                image,
                self.settings.palette_size,
                # A fabric swatch fills the frame: its "border" is the fabric itself.
                detect_background=item_type != ItemType.FABRIC,
            )
            colours = [
                {
                    "hex": c.hex,
                    "name": c.name,
                    "family": c.family,
                    "percentage": c.percentage,
                    "lab": c.lab,
                }
                for c in result.colors
            ]
            palette_source = result.source
        except PaletteError:  # e.g. a fully transparent image
            colours, palette_source = [], None

        tags = []
        if tagger is not None and vector is not None:
            tags = [
                PlaygroundTag(
                    category=p.category,
                    tag=p.tag,
                    score=p.score,
                    is_guess=vocabulary.BY_NAME[p.category].is_guess,
                )
                for p in tagger.predict(vector, item_type.value)
            ]

        look_compared = (
            vector is not None
            and embedder is not None
            and self.index.model == embedder.model_name
            and all(p.vector is not None for p in self.index.pieces)
        )
        similar_look = []
        if look_compared and vector is not None:
            scored = sorted(
                (
                    (float(np.dot(vector, p.vector)), p.id, p)
                    for p in self.index.pieces
                    if p.vector is not None
                ),
                key=lambda s: (-s[0], s[1]),
            )
            similar_look = [_match(p, similarity=round(s, 3)) for s, _, p in scored[:SIMILAR]]

        similar_palette = []
        if colours:
            by_palette = sorted(
                (palette_distance(colours, p.palette), p.id, p)
                for p in self.index.pieces
                if p.palette
            )
            similar_palette = [_match(p, distance=d) for d, _, p in by_palette[:SIMILAR]]

        return PlaygroundResult(
            width=image.width,
            height=image.height,
            type=item_type,
            type_source=type_source,
            palette=[
                PlaygroundColour(**{k: c[k] for k in ("hex", "name", "family", "percentage")})
                for c in colours
            ],
            palette_source=palette_source,
            harmony=detect_harmony([(c["lab"], c["percentage"]) for c in colours])
            if colours
            else None,
            model=model,
            look_compared=look_compared,
            tags=tags,
            similar_look=similar_look,
            similar_palette=similar_palette,
        )

    @staticmethod
    def _model_state() -> str:
        """ "loading" (and start the load, so a retry soon finds it) or "unavailable"."""
        try:
            registry.get_embedder_nowait()
        except registry.EmbedderLoading:
            return "loading"
        except registry.EmbedderUnavailable:
            return "unavailable"
        return "loading"  # finished loading just now; the next photo gets the model
