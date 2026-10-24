"""Shared FastAPI dependencies."""

from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, status

from app.core.config import Settings, get_settings
from app.storage import LocalStorage, Storage


def get_current_user_id(settings: Annotated[Settings, Depends(get_settings)]) -> UUID:
    """Who is making this request.

    MVP strategy: every request acts as the single development user. This is a stand-in for
    authentication, not a form of it, so it is refused outright in production.
    """
    if settings.app_env == "production":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication is not configured.",
        )
    return settings.dev_user_id


CurrentUserId = Annotated[UUID, Depends(get_current_user_id)]


def get_storage(settings: Annotated[Settings, Depends(get_settings)]) -> Storage:
    return LocalStorage(settings.storage_root)
