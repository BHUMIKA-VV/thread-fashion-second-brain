# Postponed annotations: the class defines a `list` method, which would otherwise shadow the
# built-in in annotations such as `list[CollectionItem]`.
from __future__ import annotations

from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models import Collection, CollectionItem, Item
from app.repositories.errors import ConflictError, NotFoundError

_UNSET = object()


class CollectionRepository:
    def __init__(self, db: Session, owner_id: UUID) -> None:
        self.db = db
        self.owner_id = owner_id

    @contextmanager
    def _unique_name_guard(self) -> Iterator[None]:
        """Run changes in a savepoint; a duplicate name rolls back only those changes."""
        try:
            with self.db.begin_nested():
                yield
                self.db.flush()
        except IntegrityError as exc:
            if "uq_collections_user_id_lower_name" in str(exc.orig):
                raise ConflictError("You already have a collection with this name.") from exc
            raise

    def create(self, name: str, description: str | None = None) -> Collection:
        collection = Collection(user_id=self.owner_id, name=name.strip(), description=description)
        with self._unique_name_guard():
            self.db.add(collection)
        return collection

    def get(self, collection_id: UUID) -> Collection | None:
        return self.db.scalar(
            select(Collection).where(
                Collection.id == collection_id, Collection.user_id == self.owner_id
            )
        )

    def get_or_raise(self, collection_id: UUID) -> Collection:
        collection = self.get(collection_id)
        if collection is None:
            raise NotFoundError("Collection not found.")
        return collection

    def list(self) -> Sequence[Collection]:
        return self.db.scalars(
            select(Collection)
            .where(Collection.user_id == self.owner_id)
            .order_by(Collection.created_at.desc(), Collection.id)
        ).all()

    def update(
        self,
        collection_id: UUID,
        *,
        name: str | None = None,
        description: str | None | object = _UNSET,
    ) -> Collection:
        collection = self.get_or_raise(collection_id)
        with self._unique_name_guard():
            if name is not None:
                collection.name = name.strip()
            if description is not _UNSET:
                collection.description = description  # type: ignore[assignment]
        return collection

    def delete(self, collection_id: UUID) -> None:
        """Delete a collection and its memberships. The items themselves are kept."""
        collection = self.get_or_raise(collection_id)
        self.db.delete(collection)
        self.db.flush()

    def add_item(
        self, collection_id: UUID, item_id: UUID, note: str | None = None
    ) -> CollectionItem:
        """Append an item to a collection. Adding an existing member is a no-op."""
        self.get_or_raise(collection_id)
        item_owned = self.db.scalar(
            select(Item.id).where(Item.id == item_id, Item.user_id == self.owner_id)
        )
        if item_owned is None:
            raise NotFoundError("Item not found.")

        existing = self.db.get(CollectionItem, (collection_id, item_id))
        if existing is not None:
            return existing

        next_position = self.db.scalar(
            select(func.coalesce(func.max(CollectionItem.position) + 1, 0)).where(
                CollectionItem.collection_id == collection_id
            )
        )
        link = CollectionItem(
            collection_id=collection_id,
            item_id=item_id,
            user_id=self.owner_id,
            position=next_position,
            note=note,
        )
        self.db.add(link)
        self.db.flush()
        return link

    def remove_item(self, collection_id: UUID, item_id: UUID) -> None:
        self.get_or_raise(collection_id)
        link = self.db.get(CollectionItem, (collection_id, item_id))
        if link is None:
            raise NotFoundError("Item is not in this collection.")
        self.db.delete(link)
        self.db.flush()
        self._renumber(collection_id)

    def links(self, collection_id: UUID) -> list[CollectionItem]:
        """Memberships in display order, with their items loaded."""
        self.get_or_raise(collection_id)
        return list(
            self.db.scalars(
                select(CollectionItem)
                .where(
                    CollectionItem.collection_id == collection_id,
                    CollectionItem.user_id == self.owner_id,
                )
                .options(selectinload(CollectionItem.item).selectinload(Item.palette))
                .order_by(CollectionItem.position, CollectionItem.created_at)
            ).all()
        )

    def _link_or_raise(self, collection_id: UUID, item_id: UUID) -> CollectionItem:
        self.get_or_raise(collection_id)
        link = self.db.get(CollectionItem, (collection_id, item_id))
        if link is None or link.user_id != self.owner_id:
            raise NotFoundError("Item is not in this collection.")
        return link

    def set_note(self, collection_id: UUID, item_id: UUID, note: str | None) -> CollectionItem:
        link = self._link_or_raise(collection_id, item_id)
        link.note = note
        self.db.flush()
        return link

    def move(self, collection_id: UUID, item_id: UUID, position: int) -> None:
        """Move an item to `position` (0-based, clamped) and renumber 0..n-1 without gaps.
        Runs in the caller's transaction, so concurrent moves cannot interleave halfway."""
        self._link_or_raise(collection_id, item_id)
        # Lock this collection's rows so two moves are applied one after the other.
        ordered = list(
            self.db.scalars(
                select(CollectionItem)
                .where(CollectionItem.collection_id == collection_id)
                .order_by(CollectionItem.position, CollectionItem.created_at)
                .with_for_update()
            ).all()
        )
        moving = next(link for link in ordered if link.item_id == item_id)
        ordered.remove(moving)
        ordered.insert(max(0, min(position, len(ordered))), moving)
        for index, link in enumerate(ordered):
            link.position = index
        self.db.flush()

    def _renumber(self, collection_id: UUID) -> None:
        ordered = self.db.scalars(
            select(CollectionItem)
            .where(CollectionItem.collection_id == collection_id)
            .order_by(CollectionItem.position, CollectionItem.created_at)
        ).all()
        for index, link in enumerate(ordered):
            link.position = index
        self.db.flush()

    def summaries(
        self, contains_item: UUID | None = None
    ) -> list[tuple[Collection, int, list[Item], bool]]:
        """(collection, item count, first 4 items for the cover, contains `contains_item`)."""
        collections = self.list()
        if not collections:
            return []
        ids = [c.id for c in collections]
        counts = dict(
            self.db.execute(
                select(CollectionItem.collection_id, func.count())
                .where(CollectionItem.collection_id.in_(ids))
                .group_by(CollectionItem.collection_id)
            ).all()
        )
        ranked = (
            select(
                CollectionItem.collection_id,
                CollectionItem.item_id,
                func.row_number()
                .over(
                    partition_by=CollectionItem.collection_id,
                    order_by=(CollectionItem.position, CollectionItem.created_at),
                )
                .label("rank"),
            )
            .where(CollectionItem.collection_id.in_(ids))
            .subquery()
        )
        cover_rows = self.db.execute(
            select(ranked.c.collection_id, Item)
            .join(Item, Item.id == ranked.c.item_id)
            .where(ranked.c.rank <= 4)
            .order_by(ranked.c.collection_id, ranked.c.rank)
        ).all()
        covers: dict[UUID, list[Item]] = {cid: [] for cid in ids}
        for collection_id, item in cover_rows:
            covers[collection_id].append(item)
        members: set[UUID] = set()
        if contains_item is not None:
            members = set(
                self.db.scalars(
                    select(CollectionItem.collection_id).where(
                        CollectionItem.item_id == contains_item,
                        CollectionItem.user_id == self.owner_id,
                    )
                ).all()
            )
        return [(c, counts.get(c.id, 0), covers[c.id], c.id in members) for c in collections]

    def list_items(self, collection_id: UUID) -> Sequence[Item]:
        self.get_or_raise(collection_id)
        return self.db.scalars(
            select(Item)
            .join(CollectionItem, CollectionItem.item_id == Item.id)
            .where(
                CollectionItem.collection_id == collection_id,
                CollectionItem.user_id == self.owner_id,
            )
            .order_by(CollectionItem.position)
        ).all()
