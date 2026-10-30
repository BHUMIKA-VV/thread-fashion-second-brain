"""The public showcase: the owner's published pieces and collections, read-only.

Every query here is filtered to the owner account and to is_public, in one place each, and
this service never writes: it doesn't index images or backfill embeddings, so a visitor can't
cause work or change anything. Similarity compares stored vectors only, which also means the
image model doesn't need to be loaded to serve the showcase.
"""

import logging
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session, selectinload

from app.models import Collection, CollectionItem, Embedding, Item, User
from app.repositories.errors import NotFoundError
from app.repositories.search import ItemSearch, SearchPage, SearchParams, visible_tags
from app.services.auth import AuthRefused
from app.services.library import LibrarySummary, library_summary
from app.storage import Storage
from app.storage.base import ObjectNotFoundError

logger = logging.getLogger(__name__)

NOT_SET_UP = AuthRefused("showcase_not_set_up", "This Thread has no public showcase yet.", 404)
PIECE_NOT_FOUND = "This piece isn't in the showcase."
# Response-size limits for public (anonymous) requests.
MAX_COLLECTIONS = 50
MAX_COLLECTION_PIECES = 200


@dataclass(frozen=True)
class Similar:
    item: Item
    similarity: float


class ShowcaseService:
    def __init__(self, db: Session, storage: Storage | None = None) -> None:
        self.db = db
        self.storage = storage
        owner = db.execute(
            select(User.id, User.display_name).where(User.is_owner, User.disabled_at.is_(None))
        ).one_or_none()
        if owner is None:
            raise NOT_SET_UP
        self.owner_id: UUID = owner.id
        self.owner_name: str = owner.display_name

    def _public(self):  # noqa: ANN202 - SQLAlchemy conditions
        return (Item.user_id == self.owner_id, Item.is_public.is_(True))

    def piece(self, item_id: UUID) -> Item:
        item = self.db.scalar(
            select(Item)
            .where(Item.id == item_id, *self._public())
            .options(selectinload(Item.palette))
        )
        if item is None:
            raise NotFoundError(PIECE_NOT_FOUND)
        return item

    def search(self, params: SearchParams) -> SearchPage:
        return ItemSearch(self.db, self.owner_id, public_only=True).search(params)

    def summary(self) -> LibrarySummary:
        return library_summary(self.db, self.owner_id, public_only=True)

    def tags(self, item_id: UUID) -> list[tuple[str, str]]:
        vt = visible_tags()
        rows = self.db.execute(
            select(vt.c.category, vt.c.tag)
            .where(vt.c.item_id == item_id)
            .order_by(vt.c.category, vt.c.tag)
        ).all()
        return [(c, t) for c, t in rows]

    def image(self, item_id: UUID, variant: str) -> tuple[bytes, str]:
        item = self.piece(item_id)
        if variant == "original":
            key, mime_type = item.original_key, item.mime_type
        else:
            key, mime_type = item.thumbnail_key, "image/webp"
        if key is None or self.storage is None:
            raise NotFoundError("Image not available.")
        try:
            return self.storage.read(key), mime_type
        except ObjectNotFoundError as exc:
            logger.error("Showcase piece %s references a missing %s file", item_id, variant)
            raise NotFoundError("Image not available.") from exc

    def similar(self, item_id: UUID, limit: int = 12) -> tuple[list[Similar], int]:
        """Nearest published pieces by the stored vectors; ([], 0) if this one isn't indexed."""
        self.piece(item_id)
        query = self.db.execute(
            select(Embedding.vector, Embedding.model_name).where(Embedding.item_id == item_id)
        ).one_or_none()
        if query is None:
            return [], 0
        vector, model_name = query
        distance = Embedding.vector.cosine_distance(vector)
        candidates = (
            *self._public(),
            Item.id != item_id,
            Embedding.model_name == model_name,
        )
        # Keep scanning the HNSW index while the owner and is_public filters drop candidates
        # (see EmbeddingService.find_similar); results are re-sorted by exact distance below.
        self.db.execute(text("SET LOCAL hnsw.iterative_scan = relaxed_order"))
        rows = self.db.execute(
            select(Item, distance.label("distance"))
            .join(Embedding, Embedding.item_id == Item.id)
            .where(*candidates)
            .options(selectinload(Item.palette))
            .order_by(distance)
            .limit(limit)
        ).all()
        compared = (
            self.db.scalar(
                select(func.count())
                .select_from(Item)
                .join(Embedding, Embedding.item_id == Item.id)
                .where(*candidates)
            )
            or 0
        )
        self.db.rollback()  # nothing was written; just end the SET LOCAL transaction
        results = sorted(
            (Similar(row.Item, round(1.0 - float(row.distance), 4)) for row in rows),
            key=lambda r: (-r.similarity, str(r.item.id)),
        )
        return results, compared

    def collections(self) -> list[tuple[Collection, int, list[UUID]]]:
        """Published collections (newest first, at most MAX_COLLECTIONS), each with its count
        of published pieces and up to 4 covers."""
        found = self.db.scalars(
            select(Collection)
            .where(Collection.user_id == self.owner_id, Collection.is_public.is_(True))
            .order_by(Collection.updated_at.desc(), Collection.id)
            .limit(MAX_COLLECTIONS)
        ).all()
        return [
            (c, self._collection_count(c.id), self._collection_item_ids(c.id, limit=4))
            for c in found
        ]

    def collection(self, collection_id: UUID) -> tuple[Collection, list[Item], int]:
        """A published collection: its first MAX_COLLECTION_PIECES published pieces, in order,
        and how many published pieces it has in all."""
        found = self.db.scalar(
            select(Collection).where(
                Collection.id == collection_id,
                Collection.user_id == self.owner_id,
                Collection.is_public.is_(True),
            )
        )
        if found is None:
            raise NotFoundError("This collection isn't in the showcase.")
        items = self.db.scalars(
            select(Item)
            .join(CollectionItem, CollectionItem.item_id == Item.id)
            .where(CollectionItem.collection_id == collection_id, *self._public())
            .options(selectinload(Item.palette))
            .order_by(CollectionItem.position, CollectionItem.created_at)
            .limit(MAX_COLLECTION_PIECES)
        ).all()
        return found, list(items), self._collection_count(collection_id)

    def _collection_count(self, collection_id: UUID) -> int:
        return (
            self.db.scalar(
                select(func.count())
                .select_from(CollectionItem)
                .join(Item, Item.id == CollectionItem.item_id)
                .where(CollectionItem.collection_id == collection_id, *self._public())
            )
            or 0
        )

    def _collection_item_ids(self, collection_id: UUID, *, limit: int) -> list[UUID]:
        return list(
            self.db.scalars(
                select(Item.id)
                .join(CollectionItem, CollectionItem.item_id == Item.id)
                .where(CollectionItem.collection_id == collection_id, *self._public())
                .order_by(CollectionItem.position, CollectionItem.created_at)
                .limit(limit)
            ).all()
        )
