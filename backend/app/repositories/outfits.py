# Postponed annotations: the class defines a `list`-free API, but stays consistent with
# repositories/collections.py and keeps forward references simple.
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models import Collection, CollectionOutfit, Item, Outfit, OutfitItem, User
from app.repositories.errors import NotFoundError

PIECES_NOT_FOUND = "One or more of these pieces could not be found."
OUTFIT_NOT_FOUND = "Outfit not found."


@dataclass(frozen=True)
class PieceEntry:
    item_id: UUID
    role: str


class OutfitRepository:
    """Every query is scoped to one owner; another owner's rows look like missing ones."""

    def __init__(self, db: Session, owner_id: UUID) -> None:
        self.db = db
        self.owner_id = owner_id

    def create(self, name: str, **fields: Any) -> Outfit:
        outfit = Outfit(user_id=self.owner_id, name=name, **fields)
        self.db.add(outfit)
        self.db.flush()
        return outfit

    def get_or_raise(self, outfit_id: UUID, *, lock: bool = False) -> Outfit:
        query = select(Outfit).where(Outfit.id == outfit_id, Outfit.user_id == self.owner_id)
        outfit = self.db.scalar(query.with_for_update() if lock else query)
        if outfit is None:
            raise NotFoundError(OUTFIT_NOT_FOUND)
        return outfit

    def count(self) -> int:
        return self.db.scalar(
            select(func.count()).select_from(Outfit).where(Outfit.user_id == self.owner_id)
        )

    def lock_owner(self) -> None:
        """Serialise this owner's creations, so parallel requests can't pass the outfit limit."""
        self.db.execute(
            select(User.id).where(User.id == self.owner_id).with_for_update(key_share=True)
        )

    def page(
        self,
        *,
        q: str | None = None,
        occasion: str | None = None,
        season: str | None = None,
        limit: int = 24,
        offset: int = 0,
    ) -> tuple[Sequence[Outfit], int]:
        conditions = [Outfit.user_id == self.owner_id]
        if q:
            tags = func.array_to_string(Outfit.style_tags, " ")
            conditions.append(
                or_(
                    Outfit.name.icontains(q, autoescape=True),
                    Outfit.description.icontains(q, autoescape=True),
                    Outfit.occasion.icontains(q, autoescape=True),
                    Outfit.notes.icontains(q, autoescape=True),
                    tags.icontains(q, autoescape=True),
                )
            )
        if occasion:
            conditions.append(func.lower(Outfit.occasion) == occasion.lower())
        if season:
            conditions.append(Outfit.season == season)
        total = self.db.scalar(select(func.count()).select_from(Outfit).where(*conditions))
        rows = self.db.scalars(
            select(Outfit)
            .where(*conditions)
            .order_by(Outfit.updated_at.desc(), Outfit.id)
            .limit(limit)
            .offset(offset)
        ).all()
        return rows, total

    def previews(self, outfit_ids: Sequence[UUID]) -> dict[UUID, list[UUID]]:
        """Each outfit's piece ids in display order, for counts and cover images."""
        found: dict[UUID, list[UUID]] = {outfit_id: [] for outfit_id in outfit_ids}
        if not found:
            return found
        rows = self.db.execute(
            select(OutfitItem.outfit_id, OutfitItem.item_id)
            .where(OutfitItem.outfit_id.in_(found), OutfitItem.user_id == self.owner_id)
            .order_by(OutfitItem.outfit_id, OutfitItem.position)
        ).all()
        for outfit_id, item_id in rows:
            found[outfit_id].append(item_id)
        return found

    def links(self, outfit_id: UUID) -> list[OutfitItem]:
        """Pieces in display order, with their items and palettes loaded."""
        return list(
            self.db.scalars(
                select(OutfitItem)
                .where(OutfitItem.outfit_id == outfit_id, OutfitItem.user_id == self.owner_id)
                .options(selectinload(OutfitItem.item).selectinload(Item.palette))
                .order_by(OutfitItem.position)
            ).all()
        )

    def replace_items(self, outfit_id: UUID, entries: Sequence[PieceEntry]) -> Outfit:
        """Make `entries` the outfit's whole ordered list, all or nothing: this runs in a
        savepoint, and the outfit row stays locked until the caller commits."""
        outfit = self.get_or_raise(outfit_id, lock=True)
        ids = [entry.item_id for entry in entries]
        owned = set(
            self.db.scalars(select(Item.id).where(Item.id.in_(ids), Item.user_id == self.owner_id))
        )
        if owned != set(ids):
            raise NotFoundError(PIECES_NOT_FOUND)
        try:
            with self.db.begin_nested():
                self.db.execute(delete(OutfitItem).where(OutfitItem.outfit_id == outfit_id))
                self.db.add_all(
                    OutfitItem(
                        outfit_id=outfit_id,
                        item_id=entry.item_id,
                        user_id=self.owner_id,
                        position=position,
                        role=entry.role,
                    )
                    for position, entry in enumerate(entries)
                )
                self.db.flush()
        except IntegrityError as exc:
            # A piece was deleted after the ownership check above.
            raise NotFoundError(PIECES_NOT_FOUND) from exc
        outfit.updated_at = func.clock_timestamp()
        self.db.flush()
        self.db.refresh(outfit)
        return outfit

    def delete(self, outfit_id: UUID) -> None:
        """Delete the outfit and its links. The pieces and collections are kept."""
        self.db.delete(self.get_or_raise(outfit_id))
        self.db.flush()
        self.db.expire_all()

    # --- collections ----------------------------------------------------------------------

    def _collection_or_raise(self, collection_id: UUID) -> None:
        found = self.db.scalar(
            select(Collection.id).where(
                Collection.id == collection_id, Collection.user_id == self.owner_id
            )
        )
        if found is None:
            raise NotFoundError("Collection not found.")

    def add_to_collection(self, collection_id: UUID, outfit_id: UUID) -> None:
        """Adding an outfit that is already there changes nothing."""
        self._collection_or_raise(collection_id)
        self.get_or_raise(outfit_id)
        if self.db.get(CollectionOutfit, (collection_id, outfit_id)) is not None:
            return
        try:
            with self.db.begin_nested():
                self.db.add(
                    CollectionOutfit(
                        collection_id=collection_id,
                        outfit_id=outfit_id,
                        user_id=self.owner_id,
                    )
                )
                self.db.flush()
        except IntegrityError as exc:
            # A parallel add got there first (fine), or either side was just deleted (404).
            self._collection_or_raise(collection_id)
            self.get_or_raise(outfit_id)
            if self.db.get(CollectionOutfit, (collection_id, outfit_id)) is None:
                raise NotFoundError(OUTFIT_NOT_FOUND) from exc

    def remove_from_collection(self, collection_id: UUID, outfit_id: UUID) -> None:
        self._collection_or_raise(collection_id)
        link = self.db.get(CollectionOutfit, (collection_id, outfit_id))
        if link is None or link.user_id != self.owner_id:
            raise NotFoundError("This outfit is not in this collection.")
        self.db.delete(link)
        self.db.flush()

    def collection_ids(self, outfit_id: UUID) -> list[UUID]:
        return list(
            self.db.scalars(
                select(CollectionOutfit.collection_id)
                .where(
                    CollectionOutfit.outfit_id == outfit_id,
                    CollectionOutfit.user_id == self.owner_id,
                )
                .order_by(CollectionOutfit.created_at, CollectionOutfit.collection_id)
            )
        )

    def in_collection(self, collection_id: UUID) -> list[Outfit]:
        return list(
            self.db.scalars(
                select(Outfit)
                .join(CollectionOutfit, CollectionOutfit.outfit_id == Outfit.id)
                .where(
                    CollectionOutfit.collection_id == collection_id,
                    CollectionOutfit.user_id == self.owner_id,
                )
                .order_by(CollectionOutfit.created_at, Outfit.id)
            )
        )
