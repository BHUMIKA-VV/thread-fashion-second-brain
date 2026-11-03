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
    WEAVE = "weave"  # recorded by people only, never suggested by the image model
    AESTHETIC = "aesthetic"
    OCCASION = "occasion"
    CRAFT = "craft"  # Indian textile and craft traditions


class TagSource(StrEnum):
    AI = "ai"
    USER = "user"


class UserTagAction(StrEnum):
    ADD = "add"  # user added a tag the model did not predict
    REMOVE = "remove"  # user rejected an AI tag; survives re-analysis


class DeepAnalysisStatus(StrEnum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class InterestKind(StrEnum):
    """Who registered interest: someone keeping their own wardrobe, or a professional."""

    WARDROBE = "wardrobe"
    STUDIO = "studio"


class InterestRole(StrEnum):
    """What a professional does (asked of studio interest only)."""

    STYLIST = "stylist"
    DESIGNER = "designer"
    BOUTIQUE = "boutique"
    TEXTILE_RESEARCHER = "textile_researcher"
    COLLECTOR = "collector"
    STUDENT = "student"
    OTHER = "other"


class Harmony(StrEnum):
    MONOCHROMATIC = "monochromatic"
    ANALOGOUS = "analogous"
    COMPLEMENTARY = "complementary"
    NEUTRAL = "neutral"
    MIXED = "mixed"


class PaletteSource(StrEnum):
    CUTOUT = "cutout"  # background removed by a segmentation model (later milestone)
    ORIGINAL = "original"  # every visible pixel of the stored image
    MASKED = "masked"  # plain backdrop detected from the border and excluded


class OutfitLayout(StrEnum):
    FEATURE = "feature"  # one large piece beside the rest
    GRID = "grid"  # equal tiles
    COLUMN = "column"  # one above the other


class OutfitPieceRole(StrEnum):
    PIECE = "piece"
    ACCESSORY = "accessory"
    INSPIRATION = "inspiration"


class OutfitSeason(StrEnum):
    SPRING = "spring"
    SUMMER = "summer"
    MONSOON = "monsoon"
    AUTUMN = "autumn"
    WINTER = "winter"
    ALL_SEASON = "all_season"


class TokenPurpose(StrEnum):
    VERIFY_EMAIL = "verify_email"
    RESET_PASSWORD = "reset_password"  # noqa: S105 (a token purpose, not a password)


def sql_in(values: type[StrEnum]) -> str:
    """Render "'a', 'b'" for use inside a CHECK constraint."""
    return ", ".join(f"'{v.value}'" for v in values)
