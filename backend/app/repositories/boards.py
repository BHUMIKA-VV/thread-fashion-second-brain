# Postponed annotations: the class defines a `list` method, which would otherwise shadow the
# built-in in annotations such as `list[BoardBlock]`.
from __future__ import annotations

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import Board, BoardBlock, CollectionItem, Item, User
from app.repositories.collections import CollectionRepository
from app.repositories.errors import NotFoundError

_UNSET = object()


class BoardRepository:
    def __init__(self, db: Session, owner_id: UUID) -> None:
        self.db = db
        self.owner_id = owner_id

    def count(self) -> int:
        return self.db.scalar(
            select(func.count()).select_from(Board).where(Board.user_id == self.owner_id)
        )

    def lock_owner(self) -> None:
        """Serialise this owner's creations, so parallel requests can't pass the board limit."""
        self.db.execute(
            select(User.id).where(User.id == self.owner_id).with_for_update(key_share=True)
        )

    def create(self, name: str, description: str | None = None) -> Board:
        board = Board(user_id=self.owner_id, name=name.strip(), description=description)
        self.db.add(board)
        self.db.flush()
        return board

    def get(self, board_id: UUID) -> Board | None:
        return self.db.scalar(
            select(Board).where(Board.id == board_id, Board.user_id == self.owner_id)
        )

    def get_or_raise(self, board_id: UUID) -> Board:
        board = self.get(board_id)
        if board is None:
            raise NotFoundError("Board not found.")
        return board

    def list(self) -> Sequence[Board]:
        return self.db.scalars(
            select(Board)
            .where(Board.user_id == self.owner_id)
            .order_by(Board.updated_at.desc(), Board.id)
        ).all()

    def update(
        self, board_id: UUID, *, name: str | None = None, description: object = _UNSET
    ) -> Board:
        board = self.get_or_raise(board_id)
        if name is not None:
            board.name = name.strip()
        if description is not _UNSET:
            board.description = description  # type: ignore[assignment]
        self.db.flush()
        return board

    def delete(self, board_id: UUID) -> None:
        """Delete a board and its blocks. The pieces themselves are kept."""
        self.db.delete(self.get_or_raise(board_id))
        self.db.flush()

    def touch(self, board: Board) -> None:
        """A change to the blocks is a change to the board."""
        board.updated_at = func.clock_timestamp()  # type: ignore[assignment]
        self.db.flush()

    # --- blocks ---------------------------------------------------------------------------

    def blocks(self, board_id: UUID) -> list[BoardBlock]:
        """Blocks in display order, with their pieces and palettes loaded."""
        self.get_or_raise(board_id)
        return list(
            self.db.scalars(
                select(BoardBlock)
                .where(BoardBlock.board_id == board_id, BoardBlock.user_id == self.owner_id)
                .options(selectinload(BoardBlock.item).selectinload(Item.palette))
                .order_by(BoardBlock.position, BoardBlock.created_at, BoardBlock.id)
            ).all()
        )

    def block_count(self, board_id: UUID) -> int:
        return self.db.scalar(
            select(func.count()).select_from(BoardBlock).where(BoardBlock.board_id == board_id)
        )

    def check_item(self, item_id: UUID) -> None:
        owned = self.db.scalar(
            select(Item.id).where(Item.id == item_id, Item.user_id == self.owner_id)
        )
        if owned is None:
            raise NotFoundError("Item not found.")

    def _locked(self, board_id: UUID) -> list[BoardBlock]:
        """This board's blocks in order, locked so two edits are applied one after the other."""
        return list(
            self.db.scalars(
                select(BoardBlock)
                .where(BoardBlock.board_id == board_id)
                .order_by(BoardBlock.position, BoardBlock.created_at, BoardBlock.id)
                .with_for_update()
            ).all()
        )

    @staticmethod
    def _number(ordered: Sequence[BoardBlock]) -> None:
        for index, block in enumerate(ordered):
            block.position = index

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
        """Insert a block at `position` (0-based, clamped; the end when None)."""
        board = self.get_or_raise(board_id)
        if item_id is not None:
            self.check_item(item_id)
        ordered = self._locked(board_id)
        block = BoardBlock(
            board_id=board_id,
            user_id=self.owner_id,
            position=len(ordered),
            kind=kind,
            item_id=item_id,
            hex=hex,
            body=body,
        )
        self.db.add(block)
        index = len(ordered) if position is None else max(0, min(position, len(ordered)))
        ordered.insert(index, block)
        self._number(ordered)
        self.touch(board)
        return block

    def block_or_raise(self, board_id: UUID, block_id: UUID) -> BoardBlock:
        self.get_or_raise(board_id)
        block = self.db.scalar(
            select(BoardBlock).where(
                BoardBlock.id == block_id,
                BoardBlock.board_id == board_id,
                BoardBlock.user_id == self.owner_id,
            )
        )
        if block is None:
            raise NotFoundError("Block is not on this board.")
        return block

    def move(self, board_id: UUID, block_id: UUID, position: int) -> None:
        """Move a block to `position` (0-based, clamped) and renumber 0..n-1 without gaps."""
        self.block_or_raise(board_id, block_id)
        ordered = self._locked(board_id)
        moving = next(b for b in ordered if b.id == block_id)
        ordered.remove(moving)
        ordered.insert(max(0, min(position, len(ordered))), moving)
        self._number(ordered)
        self.db.flush()

    def remove_block(self, board_id: UUID, block_id: UUID) -> None:
        block = self.block_or_raise(board_id, block_id)
        self.db.delete(block)
        self.db.flush()
        self._number(self._locked(board_id))
        self.touch(self.get_or_raise(board_id))

    def collection_pieces(self, collection_id: UUID) -> list[CollectionItem]:
        """The pieces of one of this owner's collections, in order (for starting a board)."""
        return CollectionRepository(self.db, self.owner_id).links(collection_id)

    def summaries(self) -> list[tuple[Board, int, list[Item]]]:
        """(board, block count, first 4 pieces for the cover), most recently changed first."""
        boards = self.list()
        if not boards:
            return []
        ids = [b.id for b in boards]
        counts = dict(
            self.db.execute(
                select(BoardBlock.board_id, func.count())
                .where(BoardBlock.board_id.in_(ids))
                .group_by(BoardBlock.board_id)
            ).all()
        )
        ranked = (
            select(
                BoardBlock.board_id,
                BoardBlock.item_id,
                func.row_number()
                .over(
                    partition_by=BoardBlock.board_id,
                    order_by=(BoardBlock.position, BoardBlock.created_at, BoardBlock.id),
                )
                .label("rank"),
            )
            .where(BoardBlock.board_id.in_(ids), BoardBlock.item_id.is_not(None))
            .subquery()
        )
        cover_rows = self.db.execute(
            select(ranked.c.board_id, Item)
            .join(Item, Item.id == ranked.c.item_id)
            .where(ranked.c.rank <= 4)
            .order_by(ranked.c.board_id, ranked.c.rank)
        ).all()
        covers: dict[UUID, list[Item]] = {bid: [] for bid in ids}
        for board_id, item in cover_rows:
            covers[board_id].append(item)
        return [(b, counts.get(b.id, 0), covers[b.id]) for b in boards]
