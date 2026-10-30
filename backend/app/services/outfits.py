"""Outfit Studio: limits and rules on top of the owner-scoped repository. No AI, no downloads."""

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy.orm import Session

from app.color.outfit import OutfitColours, outfit_colours
from app.models import Outfit, OutfitItem
from app.repositories.outfits import OutfitRepository, PieceEntry
from app.services.auth import AuthRefused

MAX_OUTFITS_PER_ACCOUNT = 200
MAX_PIECES_PER_OUTFIT = 12


def normalise_style_tags(tags: Sequence[str]) -> list[str]:
    """Lowercase, trimmed and without repeats, keeping the order they were given in."""
    return list(dict.fromkeys(tag.strip().lower() for tag in tags if tag.strip()))


def copy_name(name: str) -> str:
    suffix = " (copy)"
    return f"{name[: 120 - len(suffix)].rstrip()}{suffix}"


class OutfitService:
    def __init__(self, db: Session, owner_id: UUID) -> None:
        self.db = db
        self.repo = OutfitRepository(db, owner_id)

    def _check_room(self) -> None:
        self.repo.lock_owner()
        if self.repo.count() >= MAX_OUTFITS_PER_ACCOUNT:
            raise AuthRefused(
                "outfit_limit",
                f"Your archive has reached its limit of {MAX_OUTFITS_PER_ACCOUNT} outfits. "
                "Delete one to make room.",
                409,
            )

    def create(self, name: str, **fields: object) -> Outfit:
        self._check_room()
        return self.repo.create(name, **fields)

    def duplicate(self, outfit_id: UUID) -> Outfit:
        """A new outfit with the same details and pieces. Collections are not copied."""
        source = self.repo.get_or_raise(outfit_id)
        self._check_room()
        copy = self.repo.create(
            copy_name(source.name),
            description=source.description,
            occasion=source.occasion,
            season=source.season,
            style_tags=list(source.style_tags),
            notes=source.notes,
            layout=source.layout,
        )
        return self.repo.replace_items(
            copy.id,
            [PieceEntry(link.item_id, link.role) for link in self.repo.links(outfit_id)],
        )

    def replace_items(self, outfit_id: UUID, entries: Sequence[PieceEntry]) -> Outfit:
        if len(entries) > MAX_PIECES_PER_OUTFIT:
            raise AuthRefused(
                "outfit_too_large",
                f"An outfit can hold up to {MAX_PIECES_PER_OUTFIT} pieces.",
                422,
            )
        if len({entry.item_id for entry in entries}) != len(entries):
            raise AuthRefused("duplicate_piece", "A piece can appear in an outfit only once.", 422)
        return self.repo.replace_items(outfit_id, entries)

    @staticmethod
    def colours(links: Sequence[OutfitItem]) -> OutfitColours:
        return outfit_colours(
            [
                (link.item_id, link.item.palette.colors if link.item.palette else None)
                for link in links
            ]
        )
