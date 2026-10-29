"""Shared FastAPI dependencies."""

from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import User
from app.services.auth import AuthRefused, AuthService, Principal
from app.services.mailer import Mailer, get_mailer
from app.storage import LocalStorage, Storage


def get_storage(settings: Annotated[Settings, Depends(get_settings)]) -> Storage:
    return LocalStorage(settings.storage_root)


def get_mailer_dep(settings: Annotated[Settings, Depends(get_settings)]) -> Mailer:
    return get_mailer(settings)


def get_auth_service(
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
    mailer: Annotated[Mailer, Depends(get_mailer_dep)],
    storage: Annotated[Storage, Depends(get_storage)],
) -> AuthService:
    return AuthService(db, settings, mailer, storage)


def get_optional_user(
    request: Request,
    auth: Annotated[AuthService, Depends(get_auth_service)],
) -> Principal | None:
    """The signed-in user, or None.

    In development (and only there) a request without a valid session acts as the local
    development user, so working on Thread locally needs no sign-in. Set
    THREAD_DEV_AUTO_SIGNIN=false to try the real sign-in flow locally.
    """
    settings = auth.settings
    token = request.cookies.get(settings.session_cookie_name)
    if token:
        principal = auth.principal_for_token(token)
        if principal is not None:
            return principal
    if settings.app_env == "development" and settings.dev_auto_signin:
        user = auth.db.get(User, settings.dev_user_id)
        if user is not None and user.disabled_at is None:
            # Locally you are the owner of your own archive, claimed or not.
            return Principal(user.id, is_owner=True, email_verified=True)
    return None


OptionalUser = Annotated[Principal | None, Depends(get_optional_user)]


def get_current_user(user: OptionalUser) -> Principal:
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="not_signed_in")
    return user


CurrentUser = Annotated[Principal, Depends(get_current_user)]


def get_current_user_id(user: CurrentUser) -> UUID:
    """Whose archive this request reads and writes. Every query is scoped to this id."""
    return user.id


CurrentUserId = Annotated[UUID, Depends(get_current_user_id)]


def get_verified_user(user: CurrentUser) -> Principal:
    if not user.email_verified:
        raise AuthRefused(
            "email_not_verified", "Confirm your email address before adding pieces.", 403
        )
    return user


VerifiedUser = Annotated[Principal, Depends(get_verified_user)]


def get_owner(user: CurrentUser) -> Principal:
    if not user.is_owner:
        raise AuthRefused("owner_only", "Only the owner of this Thread can do that.", 403)
    return user


Owner = Annotated[Principal, Depends(get_owner)]


def client_ip(request: Request, settings: Annotated[Settings, Depends(get_settings)]) -> str:
    """The client's address for rate limits (see THREAD_FORWARDED_HOPS)."""
    if settings.forwarded_hops:
        forwarded = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",")]
        forwarded = [p for p in forwarded if p]
        if len(forwarded) >= settings.forwarded_hops:
            return forwarded[-settings.forwarded_hops]
    return request.client.host if request.client else "unknown"


ClientIp = Annotated[str, Depends(client_ip)]
