"""AI tags, user corrections and the effective tag set of an item.

Storage model (tags table):
- AI rows (source="ai", confidence = model score) are owned by the tagger: re-analysis deletes
  and rewrites only these, stamping model_name with the tagger version.
- User rows (source="user") record corrections: user_action="add" (a tag the model did not
  give, possibly a custom one) or "remove" (reject an AI tag). Re-analysis never touches them.
- Effective tags = AI tags + user adds - user removes.
"""

import logging
import re
from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

import numpy as np
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.ml import registry, vocabulary
from app.ml.tagging import LabelScore, Tagger
from app.models import Item, Tag
from app.models.enums import TagSource, UserTagAction
from app.services.status import set_stage
from app.services.vanished import unless_deleted

logger = logging.getLogger(__name__)

MAX_USER_TAGS = 40
_TAG_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9 '&/-]{0,38}[a-z0-9])?$")


class TagValidationError(ValueError):
    """A tag edit is invalid (bad category or text, too many tags, nothing to remove)."""


class ItemNotIndexed(LookupError):
    """The item has no current image embedding, so tag scores cannot be computed."""


@dataclass(frozen=True)
class EffectiveTag:
    category: str
    tag: str
    source: str  # "ai" | "user"
    score: float | None  # AI model score (relative, uncalibrated); None for user tags
    custom: bool  # user tag not in the controlled vocabulary
    outdated: bool  # AI tag from an older model/prompt/vocabulary version


@dataclass(frozen=True)
class TagEdit:
    category: str
    tag: str


def normalise_tag(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def validate(edit: TagEdit) -> TagEdit:
    if edit.category not in vocabulary.BY_NAME:
        raise TagValidationError(f"Unknown category '{edit.category}'.")
    tag = normalise_tag(edit.tag)
    if not _TAG_PATTERN.fullmatch(tag):
        raise TagValidationError(
            "Tags are 1-40 characters: letters, numbers, spaces and ' & / - (no leading or "
            "trailing punctuation)."
        )
    if tag == "none":
        raise TagValidationError("'none' is not a tag.")
    return TagEdit(edit.category, tag)


class TagService:
    def __init__(self, db: Session) -> None:
        self.db = db

    # --- AI tags -------------------------------------------------------------------------

    def apply_ai_tags(self, item: Item, tagger: Tagger, vector: np.ndarray) -> None:
        """Replace the item's AI tags with fresh predictions. Idempotent; user rows untouched.
        Does not commit."""
        predictions = tagger.predict(vector, item.type)
        self.db.execute(delete(Tag).where(Tag.item_id == item.id, Tag.source == TagSource.AI.value))
        self.db.add_all(
            Tag(
                item_id=item.id,
                tag=p.tag,
                category=p.category,
                confidence=p.score,
                source=TagSource.AI.value,
                model_name=tagger.version,
            )
            for p in predictions
        )
        suggested = tagger.suggest_type(vector)
        item.suggested_type = suggested.value if suggested else None
        set_stage(item, "tags", "completed")
        self.db.flush()
        self.db.expire(item, ["tags"])

    def ensure_current(self, item: Item) -> str:
        """Tag the item now if its embedding exists and its AI tags are missing or outdated.
        Never waits for a model load. Returns the tags stage outcome. Commits when it tags."""
        tagger = registry.get_tagger_if_ready()
        stage = (item.stage_status or {}).get("tags")
        embedding = item.embedding
        if tagger is None or embedding is None or embedding.model_name != tagger.model_name:
            return stage or (
                "unavailable"
                if registry.status()["state"] in ("unavailable", "disabled", "failed")
                else "pending"
            )
        current = stage == "completed" and all(
            t.model_name == tagger.version for t in item.tags if t.source == TagSource.AI.value
        )
        if not current:
            with unless_deleted(self.db, item.id):  # raises ItemDeleted if deleted meanwhile
                self.apply_ai_tags(item, tagger, np.asarray(embedding.vector, dtype=np.float32))
                self.db.commit()
        return "completed"

    def scores(self, item: Item) -> dict[str, list[LabelScore]] | None:
        """Every label's score (for "show all scores"); None if no model or no embedding."""
        tagger = registry.get_tagger_if_ready()
        embedding = item.embedding
        if tagger is None or embedding is None or embedding.model_name != tagger.model_name:
            return None
        return tagger.scores(np.asarray(embedding.vector, dtype=np.float32), item.type)

    # --- effective tags and edits --------------------------------------------------------

    def effective(self, item: Item) -> tuple[list[EffectiveTag], list[EffectiveTag]]:
        """(shown tags, AI tags the user removed). Sorted by category order, then score."""
        rows = self.db.scalars(select(Tag).where(Tag.item_id == item.id)).all()
        return effective_from_rows(rows)

    def effective_for_items(self, item_ids: Sequence[UUID]) -> dict[UUID, list[EffectiveTag]]:
        """Shown tags for many items with one query (used by similarity modes)."""
        rows = self.db.scalars(select(Tag).where(Tag.item_id.in_(list(item_ids)))).all()
        by_item: dict[UUID, list[Tag]] = {item_id: [] for item_id in item_ids}
        for row in rows:
            by_item[row.item_id].append(row)
        return {
            item_id: effective_from_rows(item_rows)[0] for item_id, item_rows in by_item.items()
        }

    def edit(self, item: Item, add: Sequence[TagEdit], remove: Sequence[TagEdit]) -> None:
        """Apply user corrections. Commits. Raises TagValidationError."""
        add = [validate(e) for e in add]
        remove = [validate(e) for e in remove]
        rows = self.db.scalars(select(Tag).where(Tag.item_id == item.id)).all()
        ai = {(t.category, t.tag) for t in rows if t.source == TagSource.AI.value}
        user = {(t.category, t.tag): t for t in rows if t.source == TagSource.USER.value}

        for edit in remove:
            key = (edit.category, edit.tag)
            row = user.get(key)
            if key in ai:  # reject an AI tag (kept as a user "remove" row)
                if row is None:
                    user[key] = self._user_row(item, edit, UserTagAction.REMOVE)
                else:
                    row.user_action = UserTagAction.REMOVE.value
            elif row is not None and row.user_action == UserTagAction.ADD.value:
                self.db.delete(row)  # undo the user's own addition
                del user[key]
            else:
                raise TagValidationError(f"'{edit.tag}' is not a tag on this item.")

        for edit in add:
            key = (edit.category, edit.tag)
            row = user.get(key)
            if key in ai:  # restoring an AI tag = dropping the rejection
                if row is not None:
                    self.db.delete(row)
                    del user[key]
            elif row is None:
                user[key] = self._user_row(item, edit, UserTagAction.ADD)
            else:
                row.user_action = UserTagAction.ADD.value

        if (
            sum(1 for r in user.values() if r.user_action == UserTagAction.ADD.value)
            > MAX_USER_TAGS
        ):
            self.db.rollback()
            raise TagValidationError(f"An item can have at most {MAX_USER_TAGS} added tags.")
        self.db.commit()

    def _user_row(self, item: Item, edit: TagEdit, action: UserTagAction) -> Tag:
        row = Tag(
            item_id=item.id,
            tag=edit.tag,
            category=edit.category,
            confidence=None,
            source=TagSource.USER.value,
            user_action=action.value,
            is_user_edited=True,
        )
        self.db.add(row)
        return row


def effective_from_rows(rows: Sequence[Tag]) -> tuple[list[EffectiveTag], list[EffectiveTag]]:
    """Merge one item's tag rows: (shown tags, AI tags the user removed)."""
    tagger = registry.get_tagger_if_ready()
    current_version = tagger.version if tagger else None
    user = {(t.category, t.tag): t for t in rows if t.source == TagSource.USER.value}
    ai = [t for t in rows if t.source == TagSource.AI.value]
    shown: list[EffectiveTag] = []
    removed: list[EffectiveTag] = []
    for t in ai:
        outdated = current_version is not None and t.model_name != current_version
        tag = EffectiveTag(t.category, t.tag, "ai", t.confidence, False, outdated)
        correction = user.get((t.category, t.tag))
        rejected = correction is not None and correction.user_action == UserTagAction.REMOVE.value
        (removed if rejected else shown).append(tag)
    ai_keys = {(t.category, t.tag) for t in ai}
    for (category, tag), row in user.items():
        if row.user_action == UserTagAction.ADD.value and (category, tag) not in ai_keys:
            custom = tag not in vocabulary.vocabulary_tags(category)
            shown.append(EffectiveTag(category, tag, "user", None, custom, False))
    order = {c.name.value: i for i, c in enumerate(vocabulary.CATEGORIES)}

    def key(t: EffectiveTag) -> tuple[int, float, str]:
        return (order.get(t.category, 99), -(t.score if t.score is not None else 2.0), t.tag)

    return sorted(shown, key=key), sorted(removed, key=key)
