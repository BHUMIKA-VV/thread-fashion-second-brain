"""The single source of truth for fashion tags: categories, labels, prompts and thresholds.

How labels become tags (see tagging.py): every prompt is encoded once with the CLIP text
encoder; a label's text vector is the normalised mean of its prompts. An image's stored
embedding is compared with every label of a category (cosine x CLIP's logit scale), and a
softmax *within that category* gives relative scores. Labels marked `none=True` describe
"none of these" (e.g. plain fabric for crafts); they compete in the softmax but are never
stored as tags, so the model can decline instead of being forced to pick something.

Scores are relative and uncalibrated. Thresholds below were set conservatively by reasoning,
not fitted to labelled data (none exists for this project); treat them as a starting point.

Changing anything here changes VOCABULARY_HASH, which marks existing AI tags as outdated and
invalidates the cached text vectors.
"""

import hashlib
import json
from dataclasses import asdict, dataclass, field

from app.models.enums import ItemType, TagCategory

# Prompt templates: "{}" is replaced by each phrase. Bump TEMPLATE_VERSION when edited.
TEMPLATE_VERSION = "pt1"
TEMPLATES = ("a photo of {}.", "a fashion photo of {}.", "a close-up photo of {}.")


@dataclass(frozen=True)
class Label:
    tag: str  # stored value: lowercase, as shown to users
    phrases: tuple[str, ...]  # what the label looks like, in plain words
    none: bool = False  # "none of these": competes in scoring, never stored


@dataclass(frozen=True)
class Category:
    name: TagCategory
    max_tags: int  # how many labels may be stored per image
    min_score: float  # a stored label needs at least this softmax score...
    min_margin: float  # ...and must beat the next-best label by this much (top label only)
    labels: tuple[Label, ...]
    skip_for: tuple[ItemType, ...] = field(default_factory=tuple)  # not meaningful for these
    is_guess: bool = False  # shown to users as a guess (fabric from a photo)


def L(tag: str, *phrases: str, none: bool = False) -> Label:  # noqa: N802 - tiny DSL
    return Label(tag=tag, phrases=phrases or (tag,), none=none)


CATEGORIES: tuple[Category, ...] = (
    Category(
        name=TagCategory.GARMENT,
        max_tags=1,
        min_score=0.45,
        min_margin=0.15,
        skip_for=(ItemType.FABRIC,),
        labels=(
            L("kurta", "a kurta, a long Indian tunic"),
            L("saree", "a woman wearing a saree, a long draped Indian garment"),
            L("lehenga", "a lehenga, a long flared Indian skirt with a blouse"),
            L("salwar suit", "a salwar kameez suit"),
            L("blazer", "a tailored blazer"),
            L("shirt", "a button-up shirt"),
            L("trousers", "a pair of trousers"),
            L("dress", "a dress"),
            L("skirt", "a skirt"),
            L("jacket", "a jacket"),
            L("dupatta", "a dupatta, a long Indian scarf"),
            L("accessory", "a fashion accessory such as a bag, jewellery or shoes"),
            L("none", "a flat piece of fabric", "an image that shows no garment", none=True),
        ),
    ),
    Category(
        name=TagCategory.SILHOUETTE,
        max_tags=1,
        min_score=0.40,
        min_margin=0.12,
        skip_for=(ItemType.FABRIC, ItemType.ACCESSORY),
        labels=(
            L("oversized", "an oversized, loose outfit"),
            L("fitted", "a fitted, close-to-the-body outfit"),
            L("relaxed", "a relaxed-fit outfit"),
            L("straight", "a straight-cut outfit"),
            L("a-line", "an A-line silhouette"),
            L("flared", "a flared silhouette"),
            L("draped", "a draped garment"),
            L("structured", "a structured, tailored garment"),
            L("layered", "a layered outfit"),
            L("none", "a flat piece of fabric", "an object that is not worn", none=True),
        ),
    ),
    Category(
        name=TagCategory.PATTERN,
        max_tags=2,
        min_score=0.30,
        min_margin=0.10,
        labels=(
            L("solid", "plain solid-colour fabric with no pattern"),
            L("floral", "fabric with a floral print"),
            L("striped", "striped fabric"),
            L("plaid", "plaid or checked fabric"),
            L("houndstooth", "houndstooth fabric"),
            L("geometric", "fabric with a geometric pattern"),
            L("paisley", "fabric with a paisley pattern"),
            L("embroidery", "embroidered fabric"),
            L("polka dot", "polka dot fabric"),
            L("abstract", "fabric with an abstract print"),
        ),
    ),
    Category(
        name=TagCategory.FABRIC,
        max_tags=1,
        min_score=0.35,
        min_margin=0.12,
        is_guess=True,
        labels=(
            L("cotton", "cotton fabric"),
            L("silk", "shiny silk fabric"),
            L("linen", "linen fabric"),
            L("denim", "denim fabric"),
            L("wool", "wool fabric"),
            L("chiffon", "sheer chiffon fabric"),
            L("georgette", "georgette fabric"),
            L("velvet", "velvet fabric"),
            L("leather", "leather"),
            L("knit", "knitted fabric"),
        ),
    ),
    Category(
        name=TagCategory.AESTHETIC,
        max_tags=2,
        min_score=0.30,
        min_margin=0.10,
        labels=(
            L("minimalist", "a minimalist outfit"),
            L("boho", "a bohemian outfit"),
            L("streetwear", "a streetwear outfit"),
            L("traditional", "traditional Indian clothing"),
            L("contemporary", "contemporary fashion"),
            L("classic", "a classic, timeless outfit"),
        ),
    ),
    Category(
        name=TagCategory.OCCASION,
        max_tags=2,
        min_score=0.30,
        min_margin=0.10,
        labels=(
            L("festive", "festive Indian clothing for a celebration"),
            L("bridal", "bridal wear"),
            L("casual", "casual everyday clothing"),
            L("formal", "formal office wear"),
            L("occasionwear", "an outfit for a party or special occasion"),
        ),
    ),
    Category(
        name=TagCategory.CRAFT,
        max_tags=2,
        min_score=0.30,
        min_margin=0.10,
        labels=(
            L("ikat", "ikat woven fabric with blurred-edge patterns"),
            L("bandhani", "bandhani tie-dye fabric with small dots"),
            L("chikankari", "chikankari white thread embroidery"),
            L("kanjeevaram", "a Kanjeevaram silk saree with a gold border"),
            L("banarasi brocade", "Banarasi brocade with gold zari weaving"),
            L("kalamkari", "Kalamkari hand-painted fabric"),
            L("ajrakh", "Ajrakh block-printed fabric in indigo and red"),
            L("chanderi", "sheer Chanderi fabric"),
            L("paithani", "a Paithani saree with a peacock border"),
            L("block print", "hand block-printed fabric"),
            L("phulkari", "Phulkari embroidery"),
            L("zardozi", "zardozi metallic embroidery"),
            L(
                "none",
                "plain fabric with no traditional craft",
                "modern western clothing",
                none=True,
            ),
        ),
    ),
)

# Suggested item type (stored in items.suggested_type, not as a tag).
ITEM_TYPE_LABELS: tuple[tuple[ItemType, str], ...] = (
    (ItemType.OUTFIT, "a person wearing a complete outfit"),
    (ItemType.GARMENT, "a single garment on its own"),
    (ItemType.FABRIC, "a close-up of a fabric swatch"),
    (ItemType.ACCESSORY, "a fashion accessory such as a bag, jewellery or shoes"),
    (ItemType.OTHER, "a fashion mood board or inspiration image"),
)
ITEM_TYPE_MIN_SCORE = 0.5

BY_NAME: dict[str, Category] = {c.name.value: c for c in CATEGORIES}


def vocabulary_tags(category: str) -> list[str]:
    """Storable (non-"none") vocabulary tags of a category."""
    return [label.tag for label in BY_NAME[category].labels if not label.none]


def _fingerprint() -> str:
    payload = {
        "templates": [TEMPLATE_VERSION, list(TEMPLATES)],
        "categories": [asdict(c) for c in CATEGORIES],
        "item_types": [[t.value, p] for t, p in ITEM_TYPE_LABELS],
        "item_type_min_score": ITEM_TYPE_MIN_SCORE,
    }
    blob = json.dumps(payload, sort_keys=True, default=str).encode()
    return hashlib.sha256(blob).hexdigest()[:10]


VOCABULARY_HASH = _fingerprint()
