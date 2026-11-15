"""What an account may do under its plan. This is the one place plan limits are decided:
upload checks, the billing page and anything else that needs an account's limits ask here.

Policy (M14-6):

- An account's plan is the one its current paid period is for, and Free when it has none.
  A period counts only when the server recorded it from a verified payment; nothing the
  browser sends can change the answer. An ended, cancelled or refunded period falls back to
  Free. The owner is exempt from every limit.
- The limits are the plan's (billing/plans.py). Until THREAD_PLAN_LIMITS_FROM is set, and for
  accounts made before that time, an account keeps at least the limits it had before plans
  (THREAD_QUOTA_ITEMS and THREAD_QUOTA_BYTES), so no existing account loses room.
- Nothing is ever deleted or hidden because of a plan. An account over its limits, after a
  period ends or a downgrade, keeps every piece and can still view, edit, present, export
  and delete them; it can't add pieces until it has room again.
- Every plan includes every archive feature (boards, presentations, Outfit Studio), so a
  plan only sets the archive's size. Exports are made in the browser and aren't limited.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.billing.plans import PlanId, plans
from app.core.config import Settings
from app.models import Item, Subscription, User
from app.models.enums import SubscriptionStatus
from app.services.auth import AuthRefused, Principal


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class Entitlement:
    plan_id: str
    plan_name: str
    # The owner: no limits.
    exempt: bool
    # Held at the limits from before plans, because they are larger than the plan's.
    legacy: bool
    # None when there is no limit (the owner).
    max_pieces: int | None
    max_bytes: int | None
    pieces: int
    bytes_used: int

    def room_for(self, incoming_bytes: int) -> bool:
        if self.max_pieces is None or self.max_bytes is None:
            return True
        return self.pieces < self.max_pieces and self.bytes_used + incoming_bytes <= self.max_bytes


def size_text(n: int) -> str:
    return f"{n / 1024**3:g} GB" if n >= 1024**3 else f"{n / 1024**2:g} MB"


class EntitlementService:
    def __init__(
        self, db: Session, settings: Settings, clock: Callable[[], datetime] = _now
    ) -> None:
        self.db = db
        self.settings = settings
        self.clock = clock
        self.plans = {p.id.value: p for p in plans(settings)}

    def plan_id(self, user_id: UUID) -> str:
        """Free, or the plan of the account's current paid period."""
        now = self.clock()
        current = self.db.scalar(
            select(Subscription.plan_id).where(
                Subscription.user_id == user_id,
                Subscription.status == SubscriptionStatus.ACTIVE.value,
                Subscription.starts_at <= now,
                Subscription.ends_at > now,
            )
        )
        return current or PlanId.FREE.value

    def for_account(self, principal: Principal) -> Entitlement:
        pieces, used = self.db.execute(
            select(func.count(), func.coalesce(func.sum(Item.file_size), 0)).where(
                Item.user_id == principal.id
            )
        ).one()
        plan = self.plans[self.plan_id(principal.id)]
        if principal.is_owner:
            return Entitlement(plan.id.value, plan.name, True, False, None, None, pieces, used)
        max_pieces, max_bytes, legacy = plan.max_pieces, plan.max_bytes, False
        if self._keeps_earlier_limits(principal.id):
            floor_pieces, floor_bytes = self.settings.quota_items, self.settings.quota_bytes
            legacy = floor_pieces > max_pieces or floor_bytes > max_bytes
            max_pieces, max_bytes = max(max_pieces, floor_pieces), max(max_bytes, floor_bytes)
        return Entitlement(
            plan.id.value, plan.name, False, legacy, max_pieces, max_bytes, pieces, used
        )

    def check_upload(self, principal: Principal, incoming_bytes: int) -> None:
        """Refuse a piece that would take the account past its plan's limits. Nothing already
        in the archive is touched."""
        ent = self.for_account(principal)
        if ent.room_for(incoming_bytes) or ent.max_pieces is None or ent.max_bytes is None:
            return
        if ent.pieces >= ent.max_pieces:
            first = (
                f"Your archive is full: {ent.plan_name} holds {ent.max_pieces} pieces "
                f"and you have {ent.pieces}."
            )
        else:
            first = f"Your archive has reached its {size_text(ent.max_bytes)} storage limit."
        way_out = self._way_out(ent.max_pieces, ent.max_bytes)
        raise AuthRefused("quota_exceeded", f"{first} {way_out}", 403)

    def _keeps_earlier_limits(self, user_id: UUID) -> bool:
        start = self.settings.plan_limits_from
        if start is None or self.clock() < start:
            return True
        created = self.db.scalar(select(User.created_at).where(User.id == user_id))
        return created is not None and created < start

    def _way_out(self, max_pieces: int, max_bytes: int) -> str:
        """What to do about a full archive: a plan with more room, if there is one."""
        larger = [
            p
            for p in self.plans.values()
            if p.price_paise > 0 and (p.max_pieces > max_pieces or p.max_bytes > max_bytes)
        ]
        kept = "Every piece you have is kept."
        if not larger:
            return f"{kept} Delete a piece to add another."
        return f"{kept} Delete a piece, or buy a period of {larger[0].name}, to add another."
