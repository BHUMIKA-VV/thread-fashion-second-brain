from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

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
