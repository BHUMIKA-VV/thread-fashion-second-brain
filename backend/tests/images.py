"""Synthetic test images generated in memory (no downloaded assets)."""

import io
import random

from PIL import Image

GPS_IFD = 0x8825
ORIENTATION = 0x0112


def image_bytes(
    fmt: str = "JPEG",
    size: tuple[int, int] = (300, 200),
    mode: str = "RGB",
    *,
    seed: int | None = None,
    orientation: int | None = None,
    with_gps: bool = False,
) -> bytes:
    """A unique (random-noise) image unless `seed` is given."""
    rng = random.Random(seed)
    image = Image.new(mode, size)
    # A few random rectangles make each image's bytes (and hash) unique.
    for _ in range(6):
        x0, y0 = rng.randrange(size[0]), rng.randrange(size[1])
        color = (
            tuple(rng.randrange(256) for _ in range(len(mode)))
            if mode != "L"
            else rng.randrange(256)
        )
        image.paste(color, (x0, y0, min(size[0], x0 + 40), min(size[1], y0 + 40)))

    exif = Image.Exif()
    if orientation is not None:
        exif[ORIENTATION] = orientation
    if with_gps:
        exif.get_ifd(GPS_IFD)[2] = (12.0, 58.0, 0.0)  # GPSLatitude
    buffer = io.BytesIO()
    options = {"exif": exif.tobytes()} if (orientation or with_gps) else {}
    image.save(buffer, format=fmt, **options)
    return buffer.getvalue()


def blocks(
    size: tuple[int, int],
    background: tuple[int, ...],
    regions: list[tuple[tuple[int, int, int, int], tuple[int, ...]]] = (),  # type: ignore[assignment]
    mode: str = "RGB",
) -> Image.Image:
    """Solid colour blocks with exactly known areas: [(box, colour), ...]."""
    image = Image.new(mode, size, background)
    for box, color in regions:
        image.paste(color, box)
    return image


def encode(image: Image.Image, fmt: str = "PNG") -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format=fmt)
    return buffer.getvalue()


def open_image(data: bytes) -> Image.Image:
    image = Image.open(io.BytesIO(data))
    image.load()
    return image
