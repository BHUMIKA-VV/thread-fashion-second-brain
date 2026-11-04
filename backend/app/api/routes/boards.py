"""Moodboards: pieces, colours, headings and notes in order. Private to their owner; deleting a
board never deletes pieces."""

from functools import lru_cache
from typing import Annotated
from uuid import UUID

import numpy as np
from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUserId
from app.color.lab import from_hex, srgb_to_lab
from app.color.naming import family_for_lab, name_for_lab
from app.db.session import get_db
from app.models import Board, BoardBlock
from app.schemas.boards import (
    BlockAdd,
    BlockColour,
    BlockRead,
    BlockUpdate,
    BoardCreate,
    BoardDetail,
    BoardSummary,
    BoardUpdate,
)
from app.schemas.items import ItemRead
from app.services.boards import BoardService

router = APIRouter(prefix="/boards", tags=["boards"])
LIMITS = {409: {"description": "Board limit reached (board_limit) or board full (board_full)"}}


def get_service(user_id: CurrentUserId, db: Annotated[Session, Depends(get_db)]) -> BoardService:
    return BoardService(db, user_id)


Service = Annotated[BoardService, Depends(get_service)]


@lru_cache(maxsize=1024)
def colour(hex_value: str) -> BlockColour:
    """A chosen colour with Thread's nearest name and family, as on measured palettes."""
    lab = srgb_to_lab(np.array(from_hex(hex_value), dtype=np.float64))
    return BlockColour(hex=hex_value, name=name_for_lab(lab), family=family_for_lab(lab))


def _block(block: BoardBlock) -> BlockRead:
    return BlockRead(
        id=block.id,
        kind=block.kind,  # type: ignore[arg-type]
        position=block.position,
        item=ItemRead.model_validate(block.item) if block.item is not None else None,
        colour=colour(block.hex) if block.hex is not None else None,
        body=block.body,
        created_at=block.created_at,
    )


def _detail(service: BoardService, board: Board) -> BoardDetail:
    return BoardDetail(
        id=board.id,
        name=board.name,
        description=board.description,
        created_at=board.created_at,
        updated_at=board.updated_at,
        blocks=[_block(b) for b in service.repo.blocks(board.id)],
    )


def _fresh(service: BoardService, board_id: UUID) -> BoardDetail:
    board = service.repo.get_or_raise(board_id)
    service.db.refresh(board)  # updated_at is set by the database
    return _detail(service, board)


@router.get("", response_model=list[BoardSummary])
def list_boards(service: Service) -> list[BoardSummary]:
    return [
        BoardSummary(
            id=b.id,
            name=b.name,
            description=b.description,
            block_count=count,
            cover_thumbnails=[ItemRead.model_validate(i).thumbnail_url for i in covers],
            created_at=b.created_at,
            updated_at=b.updated_at,
        )
        for b, count, covers in service.repo.summaries()
    ]


@router.post("", response_model=BoardDetail, status_code=status.HTTP_201_CREATED, responses=LIMITS)
def create_board(body: BoardCreate, service: Service) -> BoardDetail:
    board = service.create(body.name, body.description or None, body.from_collection_id)
    service.db.commit()
    return _fresh(service, board.id)


@router.get("/{board_id}", response_model=BoardDetail)
def get_board(board_id: UUID, service: Service) -> BoardDetail:
    return _detail(service, service.repo.get_or_raise(board_id))


@router.patch("/{board_id}", response_model=BoardDetail)
def update_board(board_id: UUID, body: BoardUpdate, service: Service) -> BoardDetail:
    changes = body.model_dump(exclude_unset=True)
    kwargs: dict[str, object] = {}
    if changes.get("name") is not None:
        kwargs["name"] = changes["name"]
    if "description" in changes:
        kwargs["description"] = changes["description"] or None
    service.repo.update(board_id, **kwargs)  # type: ignore[arg-type]
    service.db.commit()
    return _fresh(service, board_id)


@router.delete("/{board_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_board(board_id: UUID, service: Service) -> Response:
    """Deletes the board and its blocks. The pieces stay in your archive."""
    service.repo.delete(board_id)
    service.db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{board_id}/blocks", response_model=BoardDetail, responses=LIMITS)
def add_block(board_id: UUID, body: BlockAdd, service: Service) -> BoardDetail:
    service.add_block(
        board_id,
        body.kind,
        item_id=body.item_id,
        hex=body.hex,
        body=body.body,
        position=body.position,
    )
    service.db.commit()
    return _fresh(service, board_id)


@router.patch("/{board_id}/blocks/{block_id}", response_model=BoardDetail)
def update_block(
    board_id: UUID, block_id: UUID, body: BlockUpdate, service: Service
) -> BoardDetail:
    service.update_block(board_id, block_id, body.model_dump(exclude_unset=True))
    service.db.commit()
    return _fresh(service, board_id)


@router.delete("/{board_id}/blocks/{block_id}", response_model=BoardDetail)
def remove_block(board_id: UUID, block_id: UUID, service: Service) -> BoardDetail:
    service.repo.remove_block(board_id, block_id)
    service.db.commit()
    return _fresh(service, board_id)
