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


class MetricEvent(StrEnum):
    """Public pages whose visits are counted (anonymously, per day and source)."""

    LANDING_VIEW = "landing_view"
    DEMO_VIEW = "demo_view"
    HOW_IT_WORKS_VIEW = "how_it_works_view"
    PILOT_VIEW = "pilot_view"
    SIGNUP_VIEW = "signup_view"
    PLAYGROUND_VIEW = "playground_view"
    # A visit that analysed at least one photo in the playground (sent after a result).
    PLAYGROUND_ANALYSIS = "playground_analysis"


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


class BoardBlockKind(StrEnum):
    PIECE = "piece"  # a piece from the owner's archive
    COLOUR = "colour"  # a swatch, as a hex
    HEADING = "heading"
    NOTE = "note"


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


class BillingProvider(StrEnum):
    RAZORPAY = "razorpay"


class PaidPlan(StrEnum):
    """The plans that are paid for (app/billing/plans.py defines all plans, Free included)."""

    STUDIO = "studio"
    STUDIO_PRO = "studio_pro"


class PaymentStatus(StrEnum):
    CREATED = "created"  # an order exists; nothing has been paid
    PAID = "paid"  # verified with the provider (a partial refund keeps it paid)
    FAILED = "failed"
    REFUNDED = "refunded"  # refunded in full


class PaymentMethod(StrEnum):
    """Only the kind of method: card numbers, UPI IDs and bank details are never stored."""

    CARD = "card"
    UPI = "upi"
    NETBANKING = "netbanking"
    WALLET = "wallet"
    OTHER = "other"


class SubscriptionStatus(StrEnum):
    # No "expired": a period has ended once its ends_at has passed.
    ACTIVE = "active"
    CANCELLED = "cancelled"  # ended early


class CancelReason(StrEnum):
    REFUND = "refund"
    OWNER = "owner"


class BillingEventOutcome(StrEnum):
    APPLIED = "applied"  # changed a payment or an access period
    IGNORED = "ignored"  # an event type Thread doesn't act on, or nothing to change
    STALE = "stale"  # older than what is already recorded (arrived out of order)


def sql_in(values: type[StrEnum]) -> str:
    """Render "'a', 'b'" for use inside a CHECK constraint."""
    return ", ".join(f"'{v.value}'" for v in values)
