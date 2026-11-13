"""Add sample pieces to the local development library (safe to rerun).

Two sources, both local; nothing is downloaded:

  python -m scripts.seed_samples --synthetic        37 generated textile swatches (default)
  python -m scripts.seed_samples --from <folder>    your own JPEG/PNG/WebP photos
  python -m scripts.seed_samples --status           how many samples are in the library
  python -m scripts.seed_samples --remove [...]     delete only the pieces these samples created

Synthetic swatches are drawn here, deterministically: stripes, checks, ikat-like zigzags,
bandhani-like dots, paisley, ajrakh-like stars, marbling, denim and more. They are clearly
labelled as generated, not photographs, and have no licensing questions. For real fashion
photos, put files you have the right to use in database/sample_data/ (git-ignored) and use
--from.

Safety: pieces go through the same upload service as the app (validation, palette, and the
image model when installed). A file that is already in the library is skipped, never
overwritten. --remove deletes only pieces whose stored bytes are exactly a sample's bytes, so
your own uploads are never touched. Development only: refuses to run in production.
"""

import argparse
import hashlib
import io
import math
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
SEED = 20261029  # fixed, so the same files (and content hashes) are produced every time
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
    "peacock": (0, 84, 107),
    "aubergine": (74, 32, 74),
    "sage": (138, 154, 120),
    "terracotta": (190, 98, 66),
    "blush": (232, 190, 180),
    "silver": (190, 194, 198),
    "zari gold": (190, 150, 60),
    "sky": (126, 176, 204),
    "black": (22, 22, 24),
    "kashmiri red": (150, 30, 60),
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


def _grid() -> tuple[np.ndarray, np.ndarray]:
    return np.meshgrid(np.arange(SIZE[0]), np.arange(SIZE[1]))


def _paint(index: np.ndarray, colours: list[Rgb]) -> Image.Image:
    """An image from an integer array choosing a colour for each pixel."""
    return Image.fromarray(np.array(colours, dtype=np.uint8)[index % len(colours)], "RGB")


def _leheriya(colours: list[Rgb], band: int) -> Image.Image:
    """Rippling diagonal bands, as in Rajasthani wave-resist dyeing."""
    x, y = _grid()
    return _paint(((x + y + 16 * np.sin(y / 24)) // band).astype(int), colours).filter(
        ImageFilter.GaussianBlur(1.6)
    )


def _herringbone(a: Rgb, b: Rgb, width: int, step: int) -> Image.Image:
    x, y = _grid()
    slant = np.where((x // width) % 2 == 0, x % width, width - x % width)
    return _paint(((y + slant) // step).astype(int), [a, b])


def _houndstooth(a: Rgb, b: Rgb, unit: int) -> Image.Image:
    tile = np.array(
        [
            [1, 1, 1, 1, 0, 0, 0, 1],
            [1, 1, 1, 1, 0, 0, 1, 0],
            [1, 1, 1, 1, 0, 1, 0, 0],
            [1, 1, 1, 1, 1, 0, 0, 0],
            [0, 0, 0, 1, 1, 1, 1, 1],
            [0, 0, 1, 0, 0, 1, 1, 1],
            [0, 1, 0, 0, 0, 0, 1, 1],
            [1, 0, 0, 0, 0, 0, 0, 1],
        ]
    )
    x, y = _grid()
    return _paint(tile[(y // unit) % 8, (x // unit) % 8], [a, b])


def _denim(indigo: Rgb, thread: Rgb) -> Image.Image:
    """A diagonal twill with a soft fade down the middle, like worn denim."""
    x, y = _grid()
    twill = ((x + y) % 7 < 3)[..., None]
    fade = np.exp(-(((x - SIZE[0] / 2) / 190) ** 2))[..., None] * 0.35
    base = np.array(indigo) * (1 - fade) + np.array(thread) * fade
    pixels = np.where(twill, base, base * 0.72)
    return Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8), "RGB")


def _marble(colours: list[Rgb]) -> Image.Image:
    """Swirled bands, as in ebru: paint floated on water and combed through."""
    x, y = _grid()
    warp = 46 * np.sin(y / 58) + 30 * np.sin((x + y) / 37) + 18 * np.sin(x / 19)
    return _paint(((x + 1.4 * warp) // 44).astype(int), colours).filter(
        ImageFilter.GaussianBlur(1.2)
    )


def _sunburst(ground: Rgb, dye: Rgb) -> Image.Image:
    """Rays and rings spreading from one point, like a large tie-dye bloom."""
    x, y = _grid()
    dx, dy = x - SIZE[0] * 0.5, y - SIZE[1] * 0.42
    radius, angle = np.hypot(dx, dy), np.arctan2(dy, dx)
    mix = 0.5 + 0.5 * np.sin(angle * 14 + radius / 26) * np.cos(radius / 44)
    mix = np.clip(mix * 1.6 - 0.3, 0, 1)[..., None]
    pixels = np.array(ground) * (1 - mix) + np.array(dye) * mix
    image = Image.fromarray(pixels.astype(np.uint8), "RGB")
    return image.filter(ImageFilter.GaussianBlur(2))


def _patola(a: Rgb, b: Rgb, c: Rgb, cell: int) -> Image.Image:
    """Stepped diamonds built from square blocks, like double-ikat patola."""
    x, y = _grid()
    block_x, block_y = (x // 20) % cell, (y // 20) % cell
    half = cell // 2
    distance = abs(block_x - half) + abs(block_y - half)
    return _paint(np.where(distance < 2, 2, np.where(distance < half - 1, 1, 0)), [a, b, c])


def _shibori(ground: Rgb, dye: Rgb) -> Image.Image:
    """Soft-edged rings in a grid, as in cloth clamped and folded before dyeing."""
    image = Image.new("RGB", SIZE, ground)
    draw = ImageDraw.Draw(image)
    for y in range(75, SIZE[1], 150):
        for x in range(75, SIZE[0], 150):
            for radius, colour in ((58, dye), (44, ground), (28, dye), (12, ground)):
                draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=colour)
    return image.filter(ImageFilter.GaussianBlur(4))


def _boteh(draw: ImageDraw.ImageDraw, x: int, y: int, scale: float, fill: Rgb) -> None:
    """One paisley: a teardrop whose tip curls to the side."""
    points = []
    for step in range(48):
        t = step / 48 * 2 * math.pi
        wide = 0.62 * math.sin(t) * (1 - 0.45 * math.cos(t))
        curl = 0.34 * (1 + math.cos(t)) ** 2 / 4
        points.append((x + scale * (wide + curl), y - scale * math.cos(t)))
    draw.polygon(points, fill=fill)


def _paisley(ground: Rgb, motif: Rgb, accent: Rgb) -> Image.Image:
    image = Image.new("RGB", SIZE, ground)
    draw = ImageDraw.Draw(image)
    for row, y in enumerate(range(50, SIZE[1] + 80, 120)):
        for x in range(-40 + 60 * (row % 2), SIZE[0] + 60, 120):
            _boteh(draw, x, y, 46, motif)
            _boteh(draw, x + 3, y + 5, 28, ground)
            _boteh(draw, x + 5, y + 9, 15, accent)
    return image


def _jaal(ground: Rgb, line: Rgb, flower: Rgb) -> Image.Image:
    """An ogee lattice of curving vines with a flower in every opening."""
    image = Image.new("RGB", SIZE, ground)
    draw = ImageDraw.Draw(image)
    pitch, height = 120, 180
    for col in range(-1, SIZE[0] // pitch + 2):
        for side in (1, -1):
            vine = [
                (col * pitch + side * 60 * math.sin(y * math.pi / height), y)
                for y in range(0, SIZE[1] + 1, 6)
            ]
            draw.line(vine, fill=line, width=5)
    for row in range(SIZE[1] // height + 1):
        for col in range(SIZE[0] // pitch + 2):
            cx, cy = col * pitch + (pitch // 2 if row % 2 else 0), row * height + height // 2
            for petal in range(6):
                angle = petal * math.pi / 3
                px, py = cx + 13 * math.cos(angle), cy + 13 * math.sin(angle)
                draw.ellipse((px - 7, py - 7, px + 7, py + 7), fill=flower)
            draw.ellipse((cx - 5, cy - 5, cx + 5, cy + 5), fill=line)
    return image


def _ajrakh(ground: Rgb, star: Rgb, centre: Rgb) -> Image.Image:
    """Eight-pointed stars in a tight grid, after Sindhi block printing."""
    image = Image.new("RGB", SIZE, ground)
    draw = ImageDraw.Draw(image)
    for y in range(50, SIZE[1] + 100, 100):
        for x in range(50, SIZE[0] + 100, 100):
            draw.rectangle((x - 30, y - 30, x + 30, y + 30), fill=star)
            draw.polygon([(x, y - 43), (x + 43, y), (x, y + 43), (x - 43, y)], fill=star)
            draw.ellipse((x - 16, y - 16, x + 16, y + 16), fill=centre)
            draw.ellipse((x - 6, y - 6, x + 6, y + 6), fill=ground)
    return image


def _kantha(ground: Rgb, threads: list[Rgb], rng: random.Random) -> Image.Image:
    """Rows of running stitch in several threads, like quilted Bengali kantha."""
    image = Image.new("RGB", SIZE, ground)
    draw = ImageDraw.Draw(image)
    for y in range(10, SIZE[1], 15):
        thread = threads[(y // 90) % len(threads)]
        x = rng.randint(-12, 0)
        while x < SIZE[0]:
            draw.line((x, y, x + 12, y), fill=thread, width=3)
            x += 19
    return image


def _shisha(ground: Rgb, thread: Rgb, mirror: Rgb) -> Image.Image:
    """Round mirrors held by stitched rings and petals, as in shisha embroidery."""
    image = Image.new("RGB", SIZE, ground)
    draw = ImageDraw.Draw(image)
    for row, y in enumerate(range(60, SIZE[1] + 40, 130)):
        for x in range(30 + 65 * (row % 2), SIZE[0] + 40, 130):
            for petal in range(12):
                cos, sin = math.cos(petal * math.pi / 6), math.sin(petal * math.pi / 6)
                draw.line(
                    (x + 26 * cos, y + 26 * sin, x + 44 * cos, y + 44 * sin), fill=thread, width=4
                )
            draw.ellipse((x - 29, y - 29, x + 29, y + 29), fill=thread)
            draw.ellipse((x - 21, y - 21, x + 21, y + 21), fill=mirror)
            draw.arc((x - 15, y - 15, x + 15, y + 15), 200, 290, fill=(255, 255, 255), width=3)
    return image


def _batik(ground: Rgb, wax: Rgb, rng: random.Random) -> Image.Image:
    """Large leaves crossed by fine crackle, where dye seeps through cracked wax."""
    image = Image.new("RGB", SIZE, ground)
    draw = ImageDraw.Draw(image)
    for _ in range(11):
        x, y = rng.randint(0, SIZE[0]), rng.randint(0, SIZE[1])
        cos, sin = math.cos(rng.uniform(0, math.pi)), math.sin(rng.uniform(0, math.pi))
        for side in (1, -1):
            edge = [
                (
                    x + i * 12 * cos + side * 34 * math.sin(i / 16 * math.pi) * sin,
                    y + i * 12 * sin - side * 34 * math.sin(i / 16 * math.pi) * cos,
                )
                for i in range(17)
            ]
            draw.polygon([(x, y), *edge], fill=wax)
    for _ in range(46):
        x, y = rng.randint(0, SIZE[0]), rng.randint(0, SIZE[1])
        heading = rng.uniform(0, 2 * math.pi)
        points = [(x, y)]
        for _ in range(rng.randint(5, 13)):
            heading += rng.uniform(-0.8, 0.8)
            x, y = x + 24 * math.cos(heading), y + 24 * math.sin(heading)
            points.append((x, y))
        draw.line(points, fill=ground, width=2)
    return image


def _colour_block(colours: list[Rgb], stitch: Rgb) -> Image.Image:
    """Patchwork panels joined with a visible line of stitching."""
    image = Image.new("RGB", SIZE, colours[0])
    draw = ImageDraw.Draw(image)
    panels = [(0, 0, 370, 300), (370, 0, 600, 480), (0, 300, 370, 800), (370, 480, 600, 800)]
    for panel, colour in zip(panels, colours, strict=True):
        draw.rectangle(panel, fill=colour)
    for x0, y0, x1, y1 in panels:
        for x in range(x0 + 6, x1 - 8, 18):
            draw.line((x, y1 - 7, x + 10, y1 - 7), fill=stitch, width=2)
        for y in range(y0 + 6, y1 - 8, 18):
            draw.line((x1 - 7, y, x1 - 7, y + 10), fill=stitch, width=2)
    return image


def _brocade(ground: Rgb, gold: Rgb) -> Image.Image:
    """Small woven buttis on silk between bands of zari, like a Banarasi weave."""
    image = Image.new("RGB", SIZE, ground)
    draw = ImageDraw.Draw(image)
    for row, y in enumerate(range(150, 660, 75)):
        for x in range(30 + 37 * (row % 2), SIZE[0], 75):
            draw.polygon([(x, y - 16), (x + 11, y), (x, y + 16), (x - 11, y)], fill=gold)
            draw.line((x - 18, y, x + 18, y), fill=gold, width=2)
    for top in (0, 690):
        draw.rectangle((0, top, SIZE[0], top + 110), fill=gold)
        for x in range(0, SIZE[0], 30):
            draw.polygon([(x, top + 80), (x + 15, top + 30), (x + 30, top + 80)], fill=ground)
    return image


def synthetic_samples() -> list[Sample]:
    """37 deterministic swatches (identical bytes on every run and machine)."""
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
        # New recipes go at the end: they share the random sequence, so earlier swatches keep
        # their exact bytes and --remove still recognises them.
        (
            "leheriya-like waves in rani pink, marigold and ivory",
            lambda: _leheriya([d["rani pink"], d["ivory"], d["marigold"]], 26),
        ),
        (
            "leheriya-like waves in peacock, sky and ivory",
            lambda: _leheriya([d["peacock"], d["sky"], d["ivory"]], 18),
        ),
        (
            "herringbone in charcoal and silver",
            lambda: _herringbone(d["charcoal"], d["silver"], 44, 14),
        ),
        ("houndstooth in black and ivory", lambda: _houndstooth(d["black"], d["ivory"], 9)),
        ("faded denim twill", lambda: _denim(d["neel indigo"], d["sky"])),
        (
            "ebru-like marbling in aubergine, blush, zari gold and sage",
            lambda: _marble([d["aubergine"], d["blush"], d["zari gold"], d["sage"]]),
        ),
        (
            "tie-dye bloom in kashmiri red on blush",
            lambda: _sunburst(d["blush"], d["kashmiri red"]),
        ),
        (
            "patola-like stepped diamonds in kashmiri red, ivory and black",
            lambda: _patola(d["kashmiri red"], d["ivory"], d["black"], 10),
        ),
        (
            "shibori-like rings in neel indigo on ivory",
            lambda: _shibori(d["ivory"], d["neel indigo"]),
        ),
        (
            "paisley in terracotta and teal on ivory",
            lambda: _paisley(d["ivory"], d["terracotta"], d["teal"]),
        ),
        (
            "jaal vine lattice in zari gold and blush on aubergine",
            lambda: _jaal(d["aubergine"], d["zari gold"], d["blush"]),
        ),
        (
            "ajrakh-like stars in black and ivory on rust",
            lambda: _ajrakh(d["rust"], d["black"], d["ivory"]),
        ),
        (
            "kantha-like running stitch on sage",
            lambda: _kantha(d["sage"], [d["ivory"], d["rust"], d["neel indigo"]], rng),
        ),
        (
            "shisha-like mirrors in marigold thread on peacock",
            lambda: _shisha(d["peacock"], d["marigold"], d["silver"]),
        ),
        ("batik-like crackled leaves in ivory on teal", lambda: _batik(d["teal"], d["ivory"], rng)),
        (
            "patchwork panels in terracotta, sky, mehendi green and blush",
            lambda: _colour_block(
                [d["terracotta"], d["sky"], d["mehendi green"], d["blush"]], d["ivory"]
            ),
        ),
        (
            "brocade with zari bands on kashmiri red",
            lambda: _brocade(d["kashmiri red"], d["zari gold"]),
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
