"""Image embeddings for items, and owner-scoped visual similarity search.

Indexing policy (no background worker yet):
- On upload, the image is embedded only if the model is already loaded; uploads never wait
  for a model load. Otherwise stage_status["embedding"] is "pending" (weights present) or
  "unavailable" (weights missing / feature off).
- A similarity request first indexes the query item and up to BACKFILL_LIMIT of the owner's
  not-yet-indexed items, then searches. Embedding is deterministic, so indexing late gives
  exactly the vector indexing early would have.
- Failures are recorded per item ("failed") and never break uploads or palettes.
"""

import contextlib
import io
import logging
from dataclasses import dataclass
from uuid import UUID

from PIL import Image
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.ml import registry
from app.ml.embedder import Embedder
from app.models import Embedding, Item
from app.repositories.items import ItemRepository
from app.services.status import set_stage
from app.storage import Storage

logger = logging.getLogger(__name__)

BACKFILL_LIMIT = 50


class EmbeddingFailed(RuntimeError):
    """This item's image could not be embedded (recorded on the item)."""


@dataclass(frozen=True)
class SimilarItem:
    item: Item
    similarity: float  # cosine similarity in [-1, 1]; higher = more alike


@dataclass(frozen=True)
class SimilarityResult:
    results: list[SimilarItem]
    compared: int  # owner's other items with a current-model embedding
    not_indexed: int  # owner's other items that could not be compared


class EmbeddingService:
    def __init__(self, db: Session, storage: Storage, owner_id: UUID) -> None:
        self.db = db
        self.storage = storage
        self.owner_id = owner_id
        self.items = ItemRepository(db, owner_id)

    # --- indexing ------------------------------------------------------------------------

    def index(self, item: Item, embedder: Embedder, image_bytes: bytes | None = None) -> None:
        """Embed `item` and upsert its vector. Commits. Raises EmbeddingFailed."""
        try:
            data = image_bytes if image_bytes is not None else self.storage.read(item.original_key)
            with Image.open(io.BytesIO(data)) as image:
                vector = embedder.embed(image)
            if vector.shape != (embedder.dimension,):
                raise ValueError(f"unexpected vector shape {vector.shape}")
        except Exception as exc:
            logger.exception("Embedding failed for item %s", item.id)
            set_stage(item, "embedding", "failed")
            try:
                self.db.commit()
            except StaleDataError:
                # The item was deleted concurrently (e.g. while a search was backfilling it);
                # there is nothing left to mark.
                self.db.rollback()
            raise EmbeddingFailed("This image could not be indexed for similarity search.") from exc

        values = {"item_id": item.id, "model_name": embedder.model_name, "vector": vector.tolist()}
        self.db.execute(
            insert(Embedding)
            .values(**values)
            .on_conflict_do_update(
                index_elements=[Embedding.item_id],
                set_={
                    "model_name": values["model_name"],
                    "vector": values["vector"],
                    "created_at": func.clock_timestamp(),
                },
            )
        )
        set_stage(item, "embedding", "completed")
        self.db.commit()
        self.db.expire(item, ["embedding"])

    def index_after_upload(self, item: Item, image_bytes: bytes) -> None:
        """Best effort, never blocks on a model load, never raises."""
        embedder = registry.get_embedder_if_ready()
        if embedder is None:
            model = registry.status()
            # "pending": weights are installed, the model just isn't loaded yet; the item is
            # indexed by the next similarity request. "unavailable": no usable model.
            loadable = model["weights_present"] and model["state"] not in ("disabled", "failed")
            set_stage(item, "embedding", "pending" if loadable else "unavailable")
            self.db.commit()
            return
        with contextlib.suppress(EmbeddingFailed):  # the failure is recorded on the item
            self.index(item, embedder, image_bytes)

    def _is_current(self, item: Item, embedder: Embedder) -> bool:
        return item.embedding is not None and item.embedding.model_name == embedder.model_name

    # --- search --------------------------------------------------------------------------

    def find_similar(self, item_id: UUID, *, limit: int = 12) -> SimilarityResult:
        """Owner-scoped nearest neighbours by cosine distance. Never waits for a model load.

        Raises NotFoundError (not yours / missing), EmbedderLoading (retry soon),
        EmbedderUnavailable, EmbeddingFailed.
        """
        query_item = self.items.get_or_raise(item_id)
        embedder = registry.get_embedder_nowait()
        if not self._is_current(query_item, embedder):
            self.index(query_item, embedder)
        self._backfill(embedder, exclude=query_item.id)

        query_vector = query_item.embedding.vector  # type: ignore[union-attr]
        distance = Embedding.vector.cosine_distance(query_vector)
        # pgvector >= 0.8: keep scanning the HNSW index when the owner filter removes
        # candidates, so a small library still gets `limit` results. relaxed_order may return
        # rows slightly out of order, so results are re-sorted by exact distance below.
        self.db.execute(text("SET LOCAL hnsw.iterative_scan = relaxed_order"))
        rows = self.db.execute(
            select(Item, distance.label("distance"))
            .join(Embedding, Embedding.item_id == Item.id)
            .where(
                Item.user_id == self.owner_id,
                Item.id != query_item.id,
                Embedding.model_name == embedder.model_name,
            )
            .order_by(distance)
            .limit(limit)
        ).all()
        results = sorted(
            (
                SimilarItem(item=row.Item, similarity=round(1.0 - float(row.distance), 4))
                for row in rows
            ),
            key=lambda r: (-r.similarity, str(r.item.id)),
        )

        others = (
            self.db.scalar(
                select(func.count())
                .select_from(Item)
                .where(Item.user_id == self.owner_id, Item.id != query_item.id)
            )
            or 0
        )
        compared = (
            self.db.scalar(
                select(func.count())
                .select_from(Item)
                .join(Embedding, Embedding.item_id == Item.id)
                .where(
                    Item.user_id == self.owner_id,
                    Item.id != query_item.id,
                    Embedding.model_name == embedder.model_name,
                )
            )
            or 0
        )
        self.db.commit()  # ends the transaction that SET LOCAL applied to
        return SimilarityResult(results=results, compared=compared, not_indexed=others - compared)

    def _backfill(self, embedder: Embedder, *, exclude: UUID) -> None:
        """Index the owner's items that have no current-model vector (skipping known failures)."""
        missing = self.db.scalars(
            select(Item)
            .outerjoin(Embedding, Embedding.item_id == Item.id)
            .where(
                Item.user_id == self.owner_id,
                Item.id != exclude,
                (Embedding.item_id.is_(None)) | (Embedding.model_name != embedder.model_name),
                func.coalesce(Item.stage_status["embedding"].astext, "") != "failed",
            )
            .order_by(Item.created_at.desc())
            .limit(BACKFILL_LIMIT)
        ).all()
        for item in missing:
            try:
                self.index(item, embedder)
            except EmbeddingFailed:
                continue
