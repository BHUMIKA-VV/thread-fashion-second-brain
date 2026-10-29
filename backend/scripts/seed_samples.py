"""Add sample pieces to the local development library (safe to rerun).

Two sources, both local; nothing is downloaded:

  python -m scripts.seed_samples --synthetic        20 generated textile swatches (default)
  python -m scripts.seed_samples --from <folder>    your own JPEG/PNG/WebP photos
  python -m scripts.seed_samples --status           how many samples are in the library
  python -m scripts.seed_samples --remove [...]     delete only the pieces these samples created

Synthetic swatches are drawn here, deterministically: stripes, checks, ikat-like zigzags,
block-print and bandhani-like dots in Indian dye colours. They are clearly labelled as
generated, not photographs, and have no licensing questions. For real fashion photos, put
files you have the right to use in database/sample_data/ (git-ignored) and use --from.

Safety: pieces go through the same upload service as the app (validation, palette, and the
image model when installed). A file that is already in the library is skipped, never
overwritten. --remove deletes only pieces whose stored bytes are exactly a sample's bytes, so
your own uploads are never touched. Development only: refuses to run in production.
"""

import argparse
import hashlib
import io
import random
import sys
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from sqlalchemy import select

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.ml import registry
from app.ml.registry import EmbedderUnavailable
from app.models import Item
from app.models.enums import ItemType
from app.repositories.errors import ConflictError
from app.repositories.users import ensure_user
from app.services.images import ImageValidationError
from app.services.items import ItemService
from app.storage import LocalStorage

SIZE = (600, 800)
SEED = 20261029  # fixed, so the same 20 files (and content hashes) are produced every time
FOLDER_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
MAX_FOLDER_FILES = 50

Rgb = tuple[int, int, int]
DYES: dict[str, Rgb] = {
    "sindoor red": (196, 32, 38),
    "haldi yellow": (227, 160, 24),
    "neel indigo": (38, 59, 94),
    "mehendi green": (107, 124, 42),
    "ivory": (238, 230, 214),
    "rust": (168, 74, 40),
    "rani pink": (196, 40, 110),
    "charcoal": (52, 50, 48),
    "teal": (24, 110, 112),
    "marigold": (240, 140, 20),
}


@dataclass(frozen=True)
class Sample:
    filename: str
    data: bytes
    item_type: ItemType
    description: str  # written into the piece's notes

    @property
    def content_hash(self) -> str:
        return hashlib.sha256(self.data).hexdigest()


# --- synthetic swatches ------------------------------------------------------------------


def _texture(image: Image.Image, rng: random.Random, strength: int = 10) -> Image.Image:
    """Fine woven-looking noise so swatches are not flat vector fills."""
    noise = np.random.default_rng(rng.randrange(2**32)).integers(
        -strength, strength + 1, (image.height, image.width, 1)
    )
    pixels = np.clip(np.asarray(image, dtype=np.int16) + noise, 0, 255).astype(np.uint8)
    return Image.fromarray(pixels, "RGB")


def _stripes(a: Rgb, b: Rgb, width: int, vertical: bool = False) -> Image.Image:
    image = Image.new("RGB", SIZE, a)
    draw = ImageDraw.Draw(image)
    span = SIZE[0] if vertical else SIZE[1]
    for start in range(0, span, width * 2):
        box = (start, 0, start + width, SIZE[1]) if vertical else (0, start, SIZE[0], start + width)
        draw.rectangle(box, fill=b)
    return image


def _check(a: Rgb, b: Rgb, size: int) -> Image.Image:
    image = Image.new("RGB", SIZE, a)
    overlay = Image.new("RGB", SIZE, b)
    mask = Image.new("L", SIZE, 0)
    draw = ImageDraw.Draw(mask)
    for x in range(0, SIZE[0], size * 2):
        draw.rectangle((x, 0, x + size, SIZE[1]), fill=110)
    for y in range(0, SIZE[1], size * 2):
        draw.rectangle((0, y, SIZE[0], y + size), fill=110)
    for x in range(0, SIZE[0], size * 2):
        for y in range(0, SIZE[1], size * 2):
            draw.rectangle((x, y, x + size, y + size), fill=255)
    image.paste(overlay, mask=mask)
    return image


def _ikat(a: Rgb, b: Rgb, rng: random.Random) -> Image.Image:
    """Zigzag diamonds with blurred, slightly offset edges, like resist-dyed threads."""
    image = Image.new("RGB", SIZE, a)
    draw = ImageDraw.Draw(image)
    for row in range(0, SIZE[1] + 100, 100):
        offset = rng.randint(-6, 6)
        for col in range(-50, SIZE[0] + 50, 100):
            cx, cy = col + offset, row
            draw.polygon([(cx, cy - 38), (cx + 30, cy), (cx, cy + 38), (cx - 30, cy)], fill=b)
    return image.filter(ImageFilter.GaussianBlur(2.2))


def _dots(ground: Rgb, dot: Rgb, spacing: int, radius: int, ring: Rgb | None = None) -> Image.Image:
    image = Image.new("RGB", SIZE, ground)
    draw = ImageDraw.Draw(image)
    for y in range(spacing // 2, SIZE[1], spacing):
        shift = spacing // 2 if (y // spacing) % 2 else 0
        for x in range(spacing // 2 + shift, SIZE[0], spacing):
            if ring:
                draw.ellipse(
                    (x - radius - 3, y - radius - 3, x + radius + 3, y + radius + 3), fill=ring
                )
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=dot)
    return image


def _border(body: Rgb, border: Rgb, accent: Rgb) -> Image.Image:
    """A plain body with a wide woven border and a narrow accent line, like a saree edge."""
    image = Image.new("RGB", SIZE, body)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, SIZE[1] - 190, SIZE[0], SIZE[1]), fill=border)
    draw.rectangle((0, SIZE[1] - 215, SIZE[0], SIZE[1] - 200), fill=accent)
    for x in range(0, SIZE[0], 40):
        draw.polygon(
            [(x, SIZE[1] - 120), (x + 20, SIZE[1] - 150), (x + 40, SIZE[1] - 120)], fill=accent
        )
    return image


def _chevron(a: Rgb, b: Rgb) -> Image.Image:
    image = Image.new("RGB", SIZE, a)
    draw = ImageDraw.Draw(image)
    for y in range(-80, SIZE[1] + 80, 80):
        points = [(x, y + (40 if (x // 60) % 2 else 0)) for x in range(0, SIZE[0] + 60, 60)]
        draw.line(points, fill=b, width=22, joint="curve")
    return image


def _plaid(ground: Rgb, a: Rgb, b: Rgb) -> Image.Image:
    image = Image.new("RGB", SIZE, ground)
    overlay = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for x in range(0, SIZE[0], 120):
        draw.rectangle((x, 0, x + 36, SIZE[1]), fill=(*a, 150))
        draw.rectangle((x + 60, 0, x + 66, SIZE[1]), fill=(*b, 200))
    for y in range(0, SIZE[1], 120):
        draw.rectangle((0, y, SIZE[0], y + 36), fill=(*a, 150))
        draw.rectangle((0, y + 60, SIZE[0], y + 66), fill=(*b, 200))
    image.paste(overlay, mask=overlay)
    return image


def synthetic_samples() -> list[Sample]:
    """20 deterministic swatches (identical bytes on every run and machine)."""
    rng = random.Random(SEED)  # noqa: S311 (drawing patterns, not security)
    d = DYES
    recipes: list[tuple[str, Callable[[], Image.Image]]] = [
        ("stripes in sindoor red and ivory", lambda: _stripes(d["sindoor red"], d["ivory"], 26)),
        ("pinstripes in neel indigo and ivory", lambda: _stripes(d["neel indigo"], d["ivory"], 8)),
        (
            "broad stripes in haldi yellow and rust",
            lambda: _stripes(d["haldi yellow"], d["rust"], 60, True),
        ),
        ("stripes in teal and charcoal", lambda: _stripes(d["teal"], d["charcoal"], 18, True)),
        (
            "gingham check in neel indigo and ivory",
            lambda: _check(d["ivory"], d["neel indigo"], 30),
        ),
        ("check in sindoor red and ivory", lambda: _check(d["ivory"], d["sindoor red"], 46)),
        (
            "check in mehendi green and haldi yellow",
            lambda: _check(d["haldi yellow"], d["mehendi green"], 24),
        ),
        (
            "ikat-like diamonds in neel indigo and ivory",
            lambda: _ikat(d["neel indigo"], d["ivory"], rng),
        ),
        (
            "ikat-like diamonds in rust and haldi yellow",
            lambda: _ikat(d["rust"], d["haldi yellow"], rng),
        ),
        ("ikat-like diamonds in rani pink and teal", lambda: _ikat(d["teal"], d["rani pink"], rng)),
        (
            "bandhani-like dots on sindoor red",
            lambda: _dots(d["sindoor red"], d["ivory"], 34, 4, d["haldi yellow"]),
        ),
        ("bandhani-like dots on rani pink", lambda: _dots(d["rani pink"], d["ivory"], 30, 3)),
        (
            "block-print dots in indigo on ivory",
            lambda: _dots(d["ivory"], d["neel indigo"], 70, 16),
        ),
        (
            "block-print dots in rust on ivory",
            lambda: _dots(d["ivory"], d["rust"], 56, 12, d["charcoal"]),
        ),
        (
            "border in haldi yellow on a sindoor red body",
            lambda: _border(d["sindoor red"], d["haldi yellow"], d["ivory"]),
        ),
        (
            "border in rani pink on a mehendi green body",
            lambda: _border(d["mehendi green"], d["rani pink"], d["marigold"]),
        ),
        ("chevron in charcoal on ivory", lambda: _chevron(d["ivory"], d["charcoal"])),
        ("chevron in marigold on neel indigo", lambda: _chevron(d["neel indigo"], d["marigold"])),
        (
            "plaid in sindoor red and charcoal on ivory",
            lambda: _plaid(d["ivory"], d["sindoor red"], d["charcoal"]),
        ),
        (
            "plaid in teal and haldi yellow on ivory",
            lambda: _plaid(d["ivory"], d["teal"], d["haldi yellow"]),
        ),
    ]
    samples = []
    for index, (description, draw) in enumerate(recipes, start=1):
        image = _texture(draw(), rng)
        buffer = io.BytesIO()
        image.save(buffer, "PNG", optimize=False)
        samples.append(
            Sample(
                filename=f"synthetic-{index:02d}.png",
                data=buffer.getvalue(),
                item_type=ItemType.FABRIC,
                description=f"Synthetic sample swatch: {description}. Generated by "
                "scripts/seed_samples.py, not a photograph.",
            )
        )
    return samples


def folder_samples(folder: Path) -> Iterator[Sample]:
    """Image files in `folder` (not recursive). A subfolder-free layout keeps it predictable;
    the item type comes from a filename prefix such as 'garment-...' or 'outfit_...'."""
    files = sorted(
        p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in FOLDER_SUFFIXES
    )
    if len(files) > MAX_FOLDER_FILES:
        raise SystemExit(
            f"{folder} has {len(files)} images; the seed loads at most {MAX_FOLDER_FILES}."
        )
    for path in files:
        prefix = path.stem.split("-")[0].split("_")[0].lower()
        item_type = ItemType(prefix) if prefix in ItemType._value2member_map_ else ItemType.OTHER
        yield Sample(
            filename=path.name,
            data=path.read_bytes(),
            item_type=item_type,
            description=f"Sample image from {folder.name}/{path.name}.",
        )


# --- seeding -----------------------------------------------------------------------------


@dataclass
class Report:
    added: int = 0
    skipped: int = 0
    failed: int = 0
    removed: int = 0


def seed(service: ItemService, samples: list[Sample], log: Callable[[str], None] = print) -> Report:
    report = Report()
    for sample in samples:
        try:
            item = service.upload(sample.data, sample.item_type)
        except ConflictError:
            report.skipped += 1
            log(f"  skipped  {sample.filename} (already in the library)")
            continue
        except ImageValidationError as exc:
            report.failed += 1
            log(f"  failed   {sample.filename}: {exc}")
            continue
        service.items.update(item.id, notes=sample.description)
        service.db.commit()
        report.added += 1
        log(f"  added    {sample.filename} -> {item.id} ({item.processing_status})")
    return report


def sample_items(service: ItemService, samples: list[Sample]) -> list[Item]:
    hashes = [s.content_hash for s in samples]
    return list(
        service.db.scalars(
            select(Item).where(Item.user_id == service.owner_id, Item.content_hash.in_(hashes))
        )
    )


def remove(
    service: ItemService, samples: list[Sample], log: Callable[[str], None] = print
) -> Report:
    report = Report()
    for item in sample_items(service, samples):
        service.delete(item.id)
        report.removed += 1
        log(f"  removed  {item.id}")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--synthetic", action="store_true", help="20 generated swatches (default)")
    source.add_argument("--from", dest="folder", type=Path, help="a folder of your own images")
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--status", action="store_true", help="count sample pieces, change nothing")
    action.add_argument("--remove", action="store_true", help="delete only the sample pieces")
    parser.add_argument("--no-model", action="store_true", help="do not load the image model first")
    args = parser.parse_args(argv)

    settings = get_settings()
    if settings.app_env == "production":
        print("Refusing to seed: THREAD_APP_ENV is production.", file=sys.stderr)
        return 2
    if args.folder is not None:
        if not args.folder.is_dir():
            print(f"No such folder: {args.folder}", file=sys.stderr)
            return 2
        samples = list(folder_samples(args.folder))
        if not samples:
            print(f"No JPEG, PNG or WebP files in {args.folder}; nothing to do.")
            return 0
    else:
        samples = synthetic_samples()

    if not (args.status or args.remove or args.no_model):
        try:  # so samples get embeddings and AI tags now, like uploads with a warm model
            print("Loading the image model (once)...")
            registry.get_embedder()
        except EmbedderUnavailable as exc:
            print(f"Image model not available ({exc}); seeding palettes only.")

    with get_session_factory()() as db:
        ensure_user(db, settings.dev_user_id, settings.dev_user_name)
        db.commit()
        service = ItemService(
            db, LocalStorage(settings.storage_root), settings, settings.dev_user_id
        )
        if args.status:
            present = len(sample_items(service, samples))
            print(f"{present} of {len(samples)} samples are in the library.")
            return 0
        if args.remove:
            report = remove(service, samples)
            print(f"Removed {report.removed} sample pieces. Your other pieces were not touched.")
            return 0
        report = seed(service, samples)
    present = report.added + report.skipped
    print(
        f"Added {report.added}, skipped {report.skipped} already present, {report.failed} failed. "
        f"{present} of {len(samples)} samples are now in the library."
    )
    return 1 if report.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
