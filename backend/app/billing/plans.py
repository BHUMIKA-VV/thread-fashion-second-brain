"""Thread's plans: what each one includes, allows and costs.

This is the one place plans are defined. The pricing page reads them from GET /billing/plans
rather than repeating prices, and later increments (checkout, limits) will read them from
here. Prices and limits come from settings (THREAD_PLAN_*), so they can change without a
code change; what a plan includes is fixed here, because every line must describe something
Thread actually does.

The pricing is a proposal for a pilot, not validated market pricing, and nothing is on sale
yet: no payment can be taken and these limits are not enforced.
"""

from dataclasses import dataclass
from enum import StrEnum

from app.core.config import Settings

CURRENCY = "INR"


class PlanId(StrEnum):
    FREE = "free"
    STUDIO = "studio"
    STUDIO_PRO = "studio_pro"


@dataclass(frozen=True)
class Feature:
    key: str
    label: str
    detail: str


# In the order the comparison shows them. Each one exists in Thread today.
FEATURES: tuple[Feature, ...] = (
    Feature(
        "demo",
        "Museum demo",
        "Browse public-domain museum pieces, with collections, outfits and a sample board.",
    ),
    Feature(
        "playground",
        "Photo playground",
        "Measure the colours of one photo without an account. The photo isn't kept.",
    ),
    Feature("showcase", "Showcase", "Browse the pieces and collections published here."),
    Feature("swatch_cards", "Swatch cards", "Download a playground photo's colours as an image."),
    Feature("archive", "Private archive", "Your own pieces, visible only to your account."),
    Feature(
        "colour_tags",
        "Colour analysis and tagging",
        "Colours measured from each photograph, and tag suggestions marked as the model's.",
    ),
    Feature(
        "collections_search",
        "Collections and search",
        "Group pieces into collections; search by colour, tag and visual similarity.",
    ),
    Feature(
        "boards",
        "Textile moodboards",
        "Pieces, colours and notes on one board, with a calculated colour story.",
    ),
    Feature(
        "presentations",
        "Client presentations",
        "Present a board or collection full screen, or save a board as an image or A4 PDF.",
    ),
    Feature("outfit_studio", "Outfit Studio", "Compose outfits and compare their colours."),
)

PUBLIC = ("demo", "playground", "showcase", "swatch_cards")
ARCHIVE = ("archive", "colour_tags", "collections_search")
STUDIO = ("boards", "presentations", "outfit_studio")


@dataclass(frozen=True)
class Plan:
    id: PlanId
    name: str
    summary: str
    price_paise: int
    # None for Free: it isn't paid for, so it has no billing period.
    period_days: int | None
    max_pieces: int
    # None: no storage figure is set for this plan yet.
    max_bytes: int | None
    features: tuple[str, ...]


def plans(settings: Settings) -> list[Plan]:
    """The plans in order, cheapest first, with prices and limits from settings."""
    return [
        Plan(
            id=PlanId.FREE,
            name="Free",
            summary="The museum demo, the photo playground and a small private archive.",
            price_paise=0,
            period_days=None,
            max_pieces=settings.plan_free_pieces,
            max_bytes=None,
            features=PUBLIC + ARCHIVE,
        ),
        Plan(
            id=PlanId.STUDIO,
            name="Studio",
            summary="A working archive for one designer, stylist or studio.",
            price_paise=settings.plan_studio_price_paise,
            period_days=settings.plan_period_days,
            max_pieces=settings.plan_studio_pieces,
            max_bytes=settings.plan_studio_bytes,
            features=PUBLIC + ARCHIVE + STUDIO,
        ),
        Plan(
            id=PlanId.STUDIO_PRO,
            name="Studio Pro",
            summary="Everything in Studio, with room for a larger archive.",
            price_paise=settings.plan_studio_pro_price_paise,
            period_days=settings.plan_period_days,
            max_pieces=settings.plan_studio_pro_pieces,
            max_bytes=settings.plan_studio_pro_bytes,
            features=PUBLIC + ARCHIVE + STUDIO,
        ),
    ]
