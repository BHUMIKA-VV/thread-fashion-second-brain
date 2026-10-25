from collections.abc import Sequence
from typing import Any
from uuid import UUID

from sqlalchemy import Select, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models import Item
from app.repositories.errors import ConflictError, NotFoundError

# Fields a client may change through PATCH /items/{id}. Everything else is system-managed.
EDITABLE_FIELDS = frozenset({"type", "notes", "source_url"})


class ItemRepository:
    def __init__(self, db: Session, owner_id: UUID) -> None:
        self.db = db
        self.owner_id = owner_id

    def create(self, **fields: Any) -> Item:
        item = Item(user_id=self.owner_id, **fields)
        try:
            # add() inside the savepoint so a rejected row is discarded with it, leaving the
            # surrounding transaction usable.
            with self.db.begin_nested():
                self.db.add(item)
                self.db.flush()
        except IntegrityError as exc:
            if "uq_items_user_id_content_hash" in str(exc.orig):
                existing = self.find_by_hash(fields.get("content_hash", ""))
                raise ConflictError(
                    "This image is already in your library.",
                    {"existing_item_id": str(existing.id) if existing else None},
                ) from exc
            raise
        return item

    def get(self, item_id: UUID) -> Item | None:
        return self.db.scalar(select(Item).where(Item.id == item_id, Item.user_id == self.owner_id))

    def get_or_raise(self, item_id: UUID) -> Item:
        item = self.get(item_id)
        if item is None:
            raise NotFoundError("Item not found.")
        return item

    def find_by_hash(self, content_hash: str) -> Item | None:
        return self.db.scalar(
            select(Item).where(Item.user_id == self.owner_id, Item.content_hash == content_hash)
        )

    def _filtered(self, item_type: str | None) -> Select[tuple[Item]]:
        query = select(Item).where(Item.user_id == self.owner_id)
        if item_type is not None:
            query = query.where(Item.type == item_type)
        return query

    def list(
        self, *, item_type: str | None = None, limit: int = 50, offset: int = 0
    ) -> Sequence[Item]:
        return self.db.scalars(
            self._filtered(item_type)
            .options(selectinload(Item.palette))  # one extra query, not one per item
            .order_by(Item.created_at.desc(), Item.id)
            .limit(limit)
            .offset(offset)
        ).all()

    def count(self, *, item_type: str | None = None) -> int:
        subquery = self._filtered(item_type).subquery()
        return self.db.scalar(select(func.count()).select_from(subquery)) or 0

    def update(self, item_id: UUID, **fields: Any) -> Item:
        unknown = set(fields) - EDITABLE_FIELDS
        if unknown:
            raise ValueError(f"Not editable: {sorted(unknown)}")
        item = self.get_or_raise(item_id)
        for name, value in fields.items():
            setattr(item, name, value)
        self.db.flush()
        return item

    def delete(self, item_id: UUID) -> Item:
        """Delete an item; the database cascades to palette, tags, embedding and memberships.

        Returns the deleted row so the caller can remove its stored files.
        """
        item = self.get_or_raise(item_id)
        self.db.delete(item)
        self.db.flush()
        return item
