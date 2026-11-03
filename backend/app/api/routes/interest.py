"""Early access and studio pilot interest: a public form (/interest) and the owner's list
(/admin/interest). See app/services/interest.py for the privacy rules."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import ClientIp, Owner
from app.db.session import get_db
from app.schemas.interest import (
    InterestCreate,
    InterestRead,
    InterestReceived,
    InterestSummary,
    InterestUpdate,
)
from app.services.interest import InterestService

router = APIRouter(tags=["interest"])


def get_interest_service(db: Annotated[Session, Depends(get_db)]) -> InterestService:
    return InterestService(db)


Interests = Annotated[InterestService, Depends(get_interest_service)]


@router.post("/interest", response_model=InterestReceived, status_code=status.HTTP_202_ACCEPTED)
def register_interest(body: InterestCreate, interests: Interests, ip: ClientIp) -> InterestReceived:
    """Keep a visitor's interest. Answers the same way for a new or a known address."""
    interests.register(body, ip)
    return InterestReceived()


@router.get("/admin/interest", response_model=InterestSummary)
def list_interest(_: Owner, interests: Interests) -> InterestSummary:
    return interests.summary()


@router.patch("/admin/interest/{interest_id}", response_model=InterestRead)
def update_interest(
    interest_id: UUID, body: InterestUpdate, _: Owner, interests: Interests
) -> InterestRead:
    return interests.set_contacted(interest_id, body.contacted)


@router.delete("/admin/interest/{interest_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_interest(interest_id: UUID, _: Owner, interests: Interests) -> Response:
    interests.delete(interest_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
