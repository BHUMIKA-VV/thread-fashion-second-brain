"""The owner's moderation tools (/admin): list accounts, disable and re-enable them."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import func, select

from app.api.deps import Owner, get_auth_service
from app.models import Item, User
from app.schemas.auth import AccountRead
from app.services.auth import AuthService

router = APIRouter(prefix="/admin", tags=["admin"])

Auth = Annotated[AuthService, Depends(get_auth_service)]


def account_read(user: User, items: int) -> AccountRead:
    return AccountRead(
        id=user.id,
        display_name=user.display_name,
        email=user.email,
        created_at=user.created_at,
        email_verified=user.email_verified_at is not None,
        disabled=user.disabled_at is not None,
        is_owner=user.is_owner,
        items=items,
    )


def item_count(auth: AuthService, user_id: UUID) -> int:
    return auth.db.scalar(select(func.count()).where(Item.user_id == user_id)) or 0


@router.get("/accounts", response_model=list[AccountRead])
def list_accounts(_: Owner, auth: Auth) -> list[AccountRead]:
    counts = select(Item.user_id, func.count().label("n")).group_by(Item.user_id).subquery()
    rows = auth.db.execute(
        select(User, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.user_id == User.id)
        .order_by(User.created_at.desc())
    )
    return [account_read(user, n) for user, n in rows]


@router.post("/accounts/{user_id}/disable", response_model=AccountRead)
def disable_account(user_id: UUID, _: Owner, auth: Auth) -> AccountRead:
    """Sign the account out and keep it from signing in. Its data is kept."""
    user = auth.set_disabled(user_id, disabled=True)
    return account_read(user, item_count(auth, user_id))


@router.post("/accounts/{user_id}/enable", response_model=AccountRead)
def enable_account(user_id: UUID, _: Owner, auth: Auth) -> AccountRead:
    user = auth.set_disabled(user_id, disabled=False)
    return account_read(user, item_count(auth, user_id))
