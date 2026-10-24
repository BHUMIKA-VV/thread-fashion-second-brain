"""Closed vocabularies stored as VARCHAR + CHECK constraints.

CHECK constraints (rather than native Postgres ENUM types) keep migrations simple:
adding a value is a constraint swap, not an ALTER TYPE.
"""

from enum import StrEnum


class ItemType(StrEnum):
    OUTFIT = "outfit"
    GARMENT = "garment"
    FABRIC = "fabric"
    ACCESSORY = "accessory"
    OTHER = "other"


class ProcessingStatus(StrEnum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    PARTIALLY_COMPLETED = "partially_completed"
    FAILED = "failed"


class TagCategory(StrEnum):
    GARMENT = "garment"
    SILHOUETTE = "silhouette"
    PATTERN = "pattern"
    FABRIC = "fabric"
    AESTHETIC = "aesthetic"
    OCCASION = "occasion"
    CRAFT = "craft"  # Indian textile and craft traditions


class TagSource(StrEnum):
    AI = "ai"
    USER = "user"


class UserTagAction(StrEnum):
    ADD = "add"  # user added a tag the model did not predict
    REMOVE = "remove"  # user rejected an AI tag; survives re-analysis


class Harmony(StrEnum):
    MONOCHROMATIC = "monochromatic"
    ANALOGOUS = "analogous"
    COMPLEMENTARY = "complementary"
    NEUTRAL = "neutral"
    MIXED = "mixed"


class PaletteSource(StrEnum):
    CUTOUT = "cutout"
    ORIGINAL = "original"


def sql_in(values: type[StrEnum]) -> str:
    """Render "'a', 'b'" for use inside a CHECK constraint."""
    return ", ".join(f"'{v.value}'" for v in values)
