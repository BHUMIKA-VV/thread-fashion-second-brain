"""Specialised similarity modes built on top of visual search, palettes and tags.

- palette ("same palette, different silhouette"): ranks the owner's items by palette distance
  (share-weighted CIEDE2000, see app/color/compare.py). Items that share the query's
  silhouette or garment tag are excluded, but only when both items have that tag; otherwise
  nothing is excluded and the result says the shape is unknown. Needs no image model.
- fabric ("same fabric, different colour"): starts from the 100 nearest visual neighbours,
  keeps those sharing at least one fabric / pattern / craft tag with the query, then ranks
  different dominant colour families first (and by visual similarity within each group).

Every result carries plain-language reasons. Tags are model guesses or user corrections, so
reasons describe the evidence used; they are not measured accuracy.
"""

from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.color.compare import dominant_family, palette_distance
from app.models import Item, Palette
from app.repositories.items import ItemRepository
from app.services.embeddings import EmbeddingService
from app.services.tags import EffectiveTag, TagService
from app.storage import Storage

FABRIC_CANDIDATES = 100
EVIDENCE_CATEGORIES = ("fabric", "pattern", "craft")
SHAPE_CATEGORIES = ("silhouette", "garment")


class PaletteMissing(LookupError):
    """The query item has no palette (extraction failed or not run)."""


@dataclass(frozen=True)
class ModeResult:
    item: Item
    similarity: float | None  # visual cosine similarity, when known
    palette_distance: float | None  # CIEDE2000 units, when computed
    reasons: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class ModeOutcome:
    results: list[ModeResult]
    compared: int
    not_indexed: int
    notice: str | None = None


def _tags_in(tags: list[EffectiveTag], category: str) -> set[str]:
    return {t.tag for t in tags if t.category == category}


def _label(tags: set[str]) -> str:
    return " / ".join(sorted(tags))


class SimilarityModes:
    def __init__(self, db: Session, storage: Storage, owner_id: UUID) -> None:
        self.db = db
        self.storage = storage
        self.owner_id = owner_id
        self.items = ItemRepository(db, owner_id)
        self.tags = TagService(db)

    # --- palette ---------------------------------------------------------------------------

    def palette(self, item_id: UUID, *, limit: int) -> ModeOutcome:
        query = self.items.get_or_raise(item_id)
        if query.palette is None or not query.palette.colors:
            raise PaletteMissing("This item has no colour palette to compare.")
        self.tags.ensure_current(query)  # cheap if already tagged; never waits for the model

        candidates = self.db.scalars(
            select(Item)
            .join(Palette, Palette.item_id == Item.id)
            .where(Item.user_id == self.owner_id, Item.id != query.id)
            .options(selectinload(Item.palette))
        ).all()
        all_tags = self.tags.effective_for_items([query.id, *(c.id for c in candidates)])
        query_shape = {cat: _tags_in(all_tags[query.id], cat) for cat in SHAPE_CATEGORIES}
        query_family = dominant_family(query.palette.colors)

        results: list[ModeResult] = []
        for candidate in candidates:
            if candidate.palette is None:  # joined on palettes, so only if deleted meanwhile
                continue
            reasons: list[str] = []
            excluded = False
            known_shape = False
            for category in SHAPE_CATEGORIES:
                mine, theirs = query_shape[category], _tags_in(all_tags[candidate.id], category)
                if mine and theirs:
                    known_shape = True
                    if mine & theirs:
                        excluded = True
                        break
                    reasons.append(f"Different {category}: {_label(theirs)} vs {_label(mine)}")
            if excluded:
                continue
            if not known_shape:
                reasons.append("Shape unknown (no silhouette or garment tag on both), not filtered")
            distance = palette_distance(query.palette.colors, candidate.palette.colors)
            family = dominant_family(candidate.palette.colors)
            if family and family == query_family:
                reasons.insert(0, f"Both dominated by {family}")
            reasons.insert(0, f"Colour distance {distance:.1f} (CIEDE2000; lower is closer)")
            results.append(ModeResult(candidate, None, distance, reasons))

        results.sort(key=lambda r: (r.palette_distance or 0.0, str(r.item.id)))
        notice = None
        if not any(query_shape.values()):
            notice = (
                "This item has no silhouette or garment tag, so results are ranked by colour "
                "only and not filtered by shape."
            )
        return ModeOutcome(results[:limit], compared=len(candidates), not_indexed=0, notice=notice)

    # --- fabric ----------------------------------------------------------------------------

    def fabric(self, item_id: UUID, *, limit: int) -> ModeOutcome:
        embeddings = EmbeddingService(self.db, self.storage, self.owner_id)
        visual = embeddings.find_similar(item_id, limit=FABRIC_CANDIDATES)  # may raise loading
        query = self.items.get_or_raise(item_id)
        self.tags.ensure_current(query)
        for neighbour in visual.results:
            self.tags.ensure_current(neighbour.item)

        all_tags = self.tags.effective_for_items([query.id, *(r.item.id for r in visual.results)])
        evidence = {
            (t.category, t.tag) for t in all_tags[query.id] if t.category in EVIDENCE_CATEGORIES
        }
        if not evidence:
            return ModeOutcome(
                [],
                visual.compared,
                visual.not_indexed,
                notice=(
                    "This item has no fabric, pattern or craft tag yet, so there is nothing to "
                    "match on. Add one in the tags panel to use this mode."
                ),
            )
        query_family = dominant_family(query.palette.colors) if query.palette else None

        results: list[ModeResult] = []
        for neighbour in visual.results:
            theirs = {
                (t.category, t.tag)
                for t in all_tags[neighbour.item.id]
                if t.category in EVIDENCE_CATEGORIES
            }
            shared = evidence & theirs
            if not shared:
                continue
            reasons = [f"Shares {cat}: {tag}" for cat, tag in sorted(shared)]
            palette = neighbour.item.palette
            family = dominant_family(palette.colors) if palette else None
            if family and query_family and family != query_family:
                reasons.append(f"Different dominant colour: {family} vs {query_family}")
            elif family and query_family:
                reasons.append(f"Same dominant colour family ({family})")
            else:
                reasons.append("Dominant colour unknown")
            reasons.append(f"Visual similarity {neighbour.similarity:.2f}")
            results.append(ModeResult(neighbour.item, neighbour.similarity, None, reasons))

        def different_first(r: ModeResult) -> tuple[int, float]:
            different = any(reason.startswith("Different dominant") for reason in r.reasons)
            return (0 if different else 1, -(r.similarity or 0.0))

        results.sort(key=different_first)
        notice = None
        if not results:
            notice = (
                "None of the visually closest pieces share a fabric, pattern or craft tag with "
                "this item."
            )
        return ModeOutcome(results[:limit], visual.compared, visual.not_indexed, notice)
