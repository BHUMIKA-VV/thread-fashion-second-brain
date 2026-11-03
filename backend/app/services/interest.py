"""Interest from the public site: early access to a wardrobe, or the studio pilot.

Privacy rules, all enforced here:

- Nothing is stored without the visitor's consent to be contacted (the schema requires it).
- The answer is the same whether an address is new or already registered, so the form can't
  be used to find out who has registered.
- Registering again updates the existing row (one per address and kind), never duplicates it.
- Only the owner can list, mark or delete rows. Rows are deleted a year after they were last
  updated, whenever the table is written to or read.
- Addresses and messages are never logged.
"""

from datetime import timedelta
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import Interest, User
from app.models.enums import InterestKind, InterestRole
from app.repositories.errors import NotFoundError
from app.schemas.interest import InterestCreate, InterestRead, InterestSummary
from app.services.auth import AuthRefused, normalise_email, now
from app.services.rate_limit import RateLimited, limiter

RETENTION = timedelta(days=365)
# Per network address and per email address, per hour. Generous for a person, tight for a script.
LIMIT_PER_IP = 5
LIMIT_PER_EMAIL = 3


class InterestService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def register(self, body: InterestCreate, ip: str) -> None:
        if body.website:  # the hidden field: a bot. Answer as usual and keep nothing.
            return
        email = normalise_email(body.email)
        self._limit(f"interest-ip:{ip}", LIMIT_PER_IP)
        self._limit(f"interest-email:{email}", LIMIT_PER_EMAIL)
        self._forget_expired()
        stamp = now()
        fields = {
            "role": body.role.value if body.role else None,
            "name": body.name or None,
            "message": body.message or None,
            "consented_at": stamp,
            "updated_at": stamp,
        }
        statement = insert(Interest).values(email=email, kind=body.kind.value, **fields)
        self.db.execute(
            statement.on_conflict_do_update(
                index_elements=[func.lower(Interest.email), Interest.kind], set_=fields
            )
        )
        self.db.commit()

    def summary(self) -> InterestSummary:
        self._forget_expired()
        self.db.commit()
        rows = self.db.scalars(select(Interest).order_by(Interest.updated_at.desc())).all()
        studio = [r for r in rows if r.kind == InterestKind.STUDIO]
        not_owner = select(func.count()).select_from(User).where(User.is_owner.is_(False))
        return InterestSummary(
            interest=[InterestRead.model_validate(r, from_attributes=True) for r in rows],
            wardrobe=len(rows) - len(studio),
            studio=len(studio),
            studio_by_role={
                role: sum(r.role == role for r in studio)
                for role in InterestRole
                if any(r.role == role for r in studio)
            },
            accounts=self.db.scalar(not_owner) or 0,
            verified_accounts=self.db.scalar(not_owner.where(User.email_verified_at.is_not(None)))
            or 0,
        )

    def set_contacted(self, interest_id: UUID, contacted: bool) -> InterestRead:
        row = self._get(interest_id)
        row.contacted_at = (row.contacted_at or now()) if contacted else None
        self.db.commit()
        return InterestRead.model_validate(row, from_attributes=True)

    def delete(self, interest_id: UUID) -> None:
        self.db.delete(self._get(interest_id))
        self.db.commit()

    def _get(self, interest_id: UUID) -> Interest:
        row = self.db.get(Interest, interest_id)
        if row is None:
            raise NotFoundError("No such registration.")
        return row

    def _forget_expired(self) -> None:
        self.db.execute(delete(Interest).where(Interest.updated_at < now() - RETENTION))

    @staticmethod
    def _limit(key: str, limit: int) -> None:
        try:
            limiter.hit(key, limit, 3600)
        except RateLimited as exc:
            raise AuthRefused(
                "rate_limited", "Too many attempts. Try again later.", 429, exc.retry_after
            ) from exc
