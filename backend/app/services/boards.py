"""Moodboards: limits and rules on top of the owner-scoped repository. No AI; every colour on a
board is either measured from a piece or chosen by the owner."""

from uuid import UUID

from sqlalchemy.orm import Session

from app.models import Board, BoardBlock
from app.models.enums import BoardBlockKind
from app.repositories.boards import BoardRepository
from app.schemas.boards import HEADING_LENGTH
from app.services.auth import AuthRefused

MAX_BOARDS_PER_ACCOUNT = 200
MAX_BLOCKS_PER_BOARD = 120

_TEXT_KINDS = {BoardBlockKind.HEADING.value, BoardBlockKind.NOTE.value}


class BoardService:
    def __init__(self, db: Session, owner_id: UUID) -> None:
        self.db = db
        self.repo = BoardRepository(db, owner_id)

    def _check_room(self) -> None:
        self.repo.lock_owner()
        if self.repo.count() >= MAX_BOARDS_PER_ACCOUNT:
            raise AuthRefused(
                "board_limit",
                f"Your archive has reached its limit of {MAX_BOARDS_PER_ACCOUNT} boards. "
                "Delete one to make room.",
                409,
            )

    def _check_space(self, board_id: UUID, adding: int = 1) -> None:
        if self.repo.block_count(board_id) + adding > MAX_BLOCKS_PER_BOARD:
            raise AuthRefused(
                "board_full",
                f"A board can hold up to {MAX_BLOCKS_PER_BOARD} blocks. Remove one to make room.",
                409,
            )

    def create(
        self, name: str, description: str | None = None, from_collection_id: UUID | None = None
    ) -> Board:
        """A new board, empty or started from a collection: its pieces in order, each piece's
        note in the collection becoming its caption. The collection is left as it is."""
        links = (
            self.repo.collection_pieces(from_collection_id)
            if from_collection_id is not None
            else []
        )
        if len(links) > MAX_BLOCKS_PER_BOARD:
            raise AuthRefused(
                "board_full",
                f"A board can hold up to {MAX_BLOCKS_PER_BOARD} blocks; this collection has "
                f"{len(links)} pieces.",
                409,
            )
        self._check_room()
        board = self.repo.create(name, description)
        for link in links:
            self.repo.add_block(
                board.id, BoardBlockKind.PIECE.value, item_id=link.item_id, body=link.note
            )
        return board

    def add_block(
        self,
        board_id: UUID,
        kind: str,
        *,
        item_id: UUID | None = None,
        hex: str | None = None,
        body: str | None = None,
        position: int | None = None,
    ) -> BoardBlock:
        self.repo.get_or_raise(board_id)
        self._check_space(board_id)
        return self.repo.add_block(
            board_id, kind, item_id=item_id, hex=hex, body=body or None, position=position
        )

    def update_block(self, board_id: UUID, block_id: UUID, changes: dict[str, object]) -> None:
        """Apply the fields present in `changes` (body, hex, position)."""
        block = self.repo.block_or_raise(board_id, block_id)
        if "hex" in changes:
            if block.kind != BoardBlockKind.COLOUR.value or changes["hex"] is None:
                raise AuthRefused(
                    "invalid_block", "Only a colour has a hex, and it can't be cleared.", 422
                )
            block.hex = changes["hex"]  # type: ignore[assignment]
        if "body" in changes:
            body = changes["body"] or None
            if block.kind in _TEXT_KINDS and body is None:
                raise AuthRefused("invalid_block", f"A {block.kind} needs text.", 422)
            if block.kind == BoardBlockKind.HEADING.value and len(str(body)) > HEADING_LENGTH:
                raise AuthRefused(
                    "invalid_block", f"A heading can be up to {HEADING_LENGTH} characters.", 422
                )
            block.body = body  # type: ignore[assignment]
        self.db.flush()
        if changes.get("position") is not None:
            self.repo.move(board_id, block_id, changes["position"])  # type: ignore[arg-type]
        self.repo.touch(self.repo.get_or_raise(board_id))
