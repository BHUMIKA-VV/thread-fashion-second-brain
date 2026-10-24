"""Validate uploaded image bytes and produce the files Thread stores.

Nothing here trusts the filename or the client's Content-Type: the format is whatever
Pillow detects from the bytes, and the image is fully decoded before it is accepted.
"""

import io
import warnings
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

# Pillow format name -> (MIME type, file extension we store).
SUPPORTED_FORMATS = {
    "JPEG": ("image/jpeg", "jpg"),
    "PNG": ("image/png", "png"),
    "WEBP": ("image/webp", "webp"),
}


@dataclass(frozen=True)
class ImageLimits:
    max_bytes: int
    max_side: int
    min_side: int
    max_pixels: int


class ImageValidationError(ValueError):
    """Rejected upload. `code` maps to an HTTP status in the API layer."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code  # too_large | unsupported_format | invalid_image | bad_dimensions


@dataclass(frozen=True)
class ProcessedImage:
    """A validated upload, re-encoded without metadata, plus its thumbnail."""

    format: str
    mime_type: str
    extension: str
    width: int
    height: int
    original: bytes
    thumbnail: bytes


def _open(data: bytes, limits: ImageLimits) -> Image.Image:
    # Pillow warns above MAX_IMAGE_PIXELS and errors at 2x; we want a hard error at our limit,
    # so turn its warning into an exception locally (no global state is changed).
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            image = Image.open(io.BytesIO(data))
        except UnidentifiedImageError as exc:
            raise ImageValidationError(
                "invalid_image", "The file is not a readable image."
            ) from exc
        except (Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
            raise ImageValidationError("bad_dimensions", "The image has too many pixels.") from exc
    return image


def process_upload(data: bytes, limits: ImageLimits, thumbnail_side: int) -> ProcessedImage:
    if len(data) > limits.max_bytes:
        raise ImageValidationError(
            "too_large", f"The file is larger than {limits.max_bytes // (1024 * 1024)} MB."
        )
    if not data:
        raise ImageValidationError("invalid_image", "The file is empty.")

    image = _open(data, limits)
    if image.format not in SUPPORTED_FORMATS:
        raise ImageValidationError(
            "unsupported_format", "Only JPEG, PNG and WebP images are supported."
        )
    image_format = image.format
    mime_type, extension = SUPPORTED_FORMATS[image_format]

    # Header dimensions are checked BEFORE decoding pixels.
    width, height = image.size
    if width * height > limits.max_pixels:
        raise ImageValidationError("bad_dimensions", "The image has too many pixels.")
    if max(width, height) > limits.max_side:
        raise ImageValidationError(
            "bad_dimensions", f"Images may be at most {limits.max_side} px on the longest side."
        )
    if min(width, height) < limits.min_side:
        raise ImageValidationError(
            "bad_dimensions", f"Images must be at least {limits.min_side} px on each side."
        )

    try:
        image.load()  # full decode: catches truncated or corrupt pixel data
    except (OSError, SyntaxError, ValueError) as exc:
        raise ImageValidationError(
            "invalid_image", "The image file is damaged or incomplete."
        ) from exc

    icc_profile = image.info.get("icc_profile")
    # Apply the camera's orientation flag, then drop EXIF entirely (it can contain GPS data).
    upright = ImageOps.exif_transpose(image)
    if upright.mode == "CMYK":
        upright = upright.convert("RGB")

    original = _encode(upright, image_format, icc_profile)
    return ProcessedImage(
        format=image_format,
        mime_type=mime_type,
        extension=extension,
        width=upright.width,
        height=upright.height,
        original=original,
        thumbnail=make_thumbnail(upright, thumbnail_side, icc_profile),
    )


def _encode(image: Image.Image, image_format: str, icc_profile: bytes | None) -> bytes:
    """Re-encode with only the colour profile kept (no EXIF, XMP or comments)."""
    buffer = io.BytesIO()
    options: dict[str, object] = {}
    if icc_profile:
        options["icc_profile"] = icc_profile  # keeps colours accurate for palette extraction
    if image_format == "JPEG":
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")
        options.update(quality=95, subsampling=0)
    elif image_format == "WEBP":
        options.update(quality=95, method=4)
    image.save(buffer, format=image_format, **options)
    return buffer.getvalue()


def make_thumbnail(image: Image.Image, side: int, icc_profile: bytes | None = None) -> bytes:
    thumb = image.copy()
    if thumb.mode not in ("RGB", "RGBA"):
        thumb = thumb.convert(
            "RGBA" if "transparency" in thumb.info or thumb.mode in ("LA", "PA") else "RGB"
        )
    thumb.thumbnail((side, side), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    options: dict[str, object] = {"quality": 85, "method": 4}
    if icc_profile:
        options["icc_profile"] = icc_profile
    thumb.save(buffer, format="WEBP", **options)
    return buffer.getvalue()
