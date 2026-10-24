from uuid import UUID

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import User


def ensure_user(db: Session, user_id: UUID, display_name: str) -> None:
    """Create the user if missing. Safe to call on every startup."""
    db.execute(
        insert(User)
        .values(id=user_id, display_name=display_name)
        .on_conflict_do_nothing(index_elements=[User.id])
    )
