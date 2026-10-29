"""Writes that can race with deleting the item they write to.

There is no background worker yet, so indexing and tagging run inside requests (GET tags,
similarity) and can overlap a DELETE of the same item. The write then fails on a foreign key
(new embedding or tag rows) or as stale data (the item row itself). That is not a server
error: the item is gone, so the request should answer 404 like any other missing item.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.models import Item
from app.repositories.errors import NotFoundError


class ItemDeleted(NotFoundError):
    """The item was deleted while this request was writing to it (maps to 404)."""

    def __init__(self) -> None:
        super().__init__("Item not found.")


@contextmanager
def unless_deleted(db: Session, item_id: UUID) -> Iterator[None]:
    """Run a block of writes (including its commit). If it fails because `item_id` was deleted
    meanwhile, roll back and raise ItemDeleted; any other failure (a real constraint bug) is
    re-raised unchanged. Pass the id, not the item: after a rollback the item is expired."""
    try:
        yield
    except (IntegrityError, StaleDataError):
        db.rollback()
        if db.scalar(select(Item.id).where(Item.id == item_id)) is None:
            raise ItemDeleted() from None
        raise
