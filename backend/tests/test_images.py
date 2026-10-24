"""Image validation and normalisation (no database needed)."""

import struct
import zlib

import pytest

from app.services.images import ImageLimits, ImageValidationError, process_upload
from tests.images import GPS_IFD, ORIENTATION, image_bytes, open_image

LIMITS = ImageLimits(max_bytes=5 * 1024 * 1024, max_side=2000, min_side=64, max_pixels=3_000_000)


def process(data: bytes, limits: ImageLimits = LIMITS):
    return process_upload(data, limits, thumbnail_side=128)


@pytest.mark.parametrize(
    ("fmt", "mime", "ext"),
    [("JPEG", "image/jpeg", "jpg"), ("PNG", "image/png", "png"), ("WEBP", "image/webp", "webp")],
)
def test_supported_formats_are_accepted(fmt: str, mime: str, ext: str) -> None:
    result = process(image_bytes(fmt, (300, 200)))

    assert (result.format, result.mime_type, result.extension) == (fmt, mime, ext)
    assert (result.width, result.height) == (300, 200)
    assert open_image(result.original).format == fmt
    thumb = open_image(result.thumbnail)
    assert thumb.format == "WEBP" and max(thumb.size) == 128


def test_format_is_detected_from_bytes_not_names() -> None:
    # PNG bytes are reported as PNG whatever the client claims; there is no filename input.
    assert process(image_bytes("PNG")).mime_type == "image/png"


def test_png_with_transparency_and_palette_mode() -> None:
    assert process(image_bytes("PNG", mode="RGBA")).format == "PNG"
    assert process(image_bytes("PNG", mode="P")).format == "PNG"
    assert open_image(process(image_bytes("PNG", mode="RGBA")).thumbnail).mode == "RGBA"


def test_exif_orientation_is_applied_and_metadata_stripped() -> None:
    # Orientation 6 = rotate 90° clockwise to display: 300x200 stored becomes 200x300.
    data = image_bytes("JPEG", (300, 200), orientation=6, with_gps=True)
    assert open_image(data).getexif().get(ORIENTATION) == 6

    result = process(data)

    assert (result.width, result.height) == (200, 300)
    stored = open_image(result.original)
    assert stored.size == (200, 300)
    exif = stored.getexif()
    assert ORIENTATION not in exif
    assert not exif.get_ifd(GPS_IFD)


@pytest.mark.parametrize(
    "data",
    [
        b"",
        b"this is not an image",
        b"\x89PNG\r\n\x1a\n" + b"\x00" * 100,  # PNG signature, garbage body
        b"<svg xmlns='http://www.w3.org/2000/svg'/>",
    ],
)
def test_non_images_are_rejected(data: bytes) -> None:
    with pytest.raises(ImageValidationError) as excinfo:
        process(data)
    assert excinfo.value.code == "invalid_image"


def test_truncated_image_is_rejected() -> None:
    data = image_bytes("JPEG", (400, 400))
    with pytest.raises(ImageValidationError) as excinfo:
        process(data[: len(data) // 2])
    assert excinfo.value.code == "invalid_image"


@pytest.mark.parametrize("fmt", ["GIF", "BMP", "TIFF"])
def test_other_real_image_formats_are_unsupported(fmt: str) -> None:
    with pytest.raises(ImageValidationError) as excinfo:
        process(image_bytes(fmt, mode="RGB" if fmt != "GIF" else "P"))
    assert excinfo.value.code == "unsupported_format"


def test_file_size_limit() -> None:
    data = image_bytes("PNG", (300, 300))
    tight = ImageLimits(max_bytes=len(data) - 1, max_side=2000, min_side=64, max_pixels=10**7)

    with pytest.raises(ImageValidationError) as excinfo:
        process(data, tight)
    assert excinfo.value.code == "too_large"


@pytest.mark.parametrize(
    ("size", "message"),
    [((2100, 100), "at most 2000"), ((63, 300), "at least 64"), ((1900, 1900), "too many pixels")],
)
def test_dimension_limits(size: tuple[int, int], message: str) -> None:
    with pytest.raises(ImageValidationError, match=message) as excinfo:
        process(image_bytes("PNG", size, mode="L"))
    assert excinfo.value.code == "bad_dimensions"


@pytest.mark.parametrize(
    "side",
    [
        1900,  # 3.6 MP: Pillow would open it, our max_pixels limit must reject it
        30000,  # 900 MP: Pillow's own bomb guard trips; we must still answer cleanly
    ],
)
def test_decompression_bomb_header_is_rejected_before_decoding(side: int) -> None:
    # A ~60-byte PNG whose header claims side x side pixels; it never gets decoded.
    def chunk(kind: bytes, payload: bytes) -> bytes:
        body = kind + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">IIBBBBB", side, side, 8, 0, 0, 0, 0)  # 8-bit greyscale
    bomb = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(b"\x00"))
        + chunk(b"IEND", b"")
    )
    assert len(bomb) < 100

    with pytest.raises(ImageValidationError) as excinfo:
        process(bomb)
    assert excinfo.value.code == "bad_dimensions"


def test_cmyk_jpeg_is_converted_to_rgb() -> None:
    result = process(image_bytes("JPEG", mode="CMYK"))
    assert open_image(result.original).mode == "RGB"
