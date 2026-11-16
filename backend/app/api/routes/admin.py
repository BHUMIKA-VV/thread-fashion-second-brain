"""The owner's tools (/admin): accounts (list, disable, re-enable) and billing (M14-7).

Every route here is owner-only. Billing is read-only apart from asking Razorpay again about
one payment (services/admin_billing.py); owner actions are recorded in admin_actions.
"""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Owner, get_auth_service
from app.api.routes.billing import get_payment_provider
from app.billing.razorpay import PaymentProvider
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import Item, User
from app.models.enums import AdminActionKind
from app.schemas.admin import AdminAccountBilling, AdminActionRead, BillingSummary, LookupResult
from app.schemas.auth import AccountRead
from app.schemas.billing import PaymentPage, PaymentRead
from app.services.admin_billing import AdminBilling, record
from app.services.auth import AuthService

router = APIRouter(prefix="/admin", tags=["admin"])

Auth = Annotated[AuthService, Depends(get_auth_service)]
NO_STORE = "no-store"


def get_admin_billing(
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
    provider: Annotated[PaymentProvider | None, Depends(get_payment_provider)],
) -> AdminBilling:
    return AdminBilling(db, settings, provider)


Billing = Annotated[AdminBilling, Depends(get_admin_billing)]


def account_read(user: User, items: int, plan: tuple[str, datetime] | None = None) -> AccountRead:
    return AccountRead(
        id=user.id,
        display_name=user.display_name,
        email=user.email,
        created_at=user.created_at,
        email_verified=user.email_verified_at is not None,
        disabled=user.disabled_at is not None,
        is_owner=user.is_owner,
        items=items,
        plan_id=plan[0] if plan else "free",  # type: ignore[arg-type]
        plan_until=plan[1] if plan else None,
    )


def item_count(db: Session, user_id: UUID) -> int:
    return db.scalar(select(func.count()).where(Item.user_id == user_id)) or 0


def one_account(billing: AdminBilling, user: User) -> AccountRead:
    plan = billing.current_plans([user.id]).get(user.id)
    return account_read(user, item_count(billing.db, user.id), plan)


# --- accounts --------------------------------------------------------------------------------


@router.get("/accounts", response_model=list[AccountRead])
def list_accounts(_: Owner, auth: Auth, billing: Billing, response: Response) -> list[AccountRead]:
    response.headers["Cache-Control"] = NO_STORE
    counts = select(Item.user_id, func.count().label("n")).group_by(Item.user_id).subquery()
    rows = auth.db.execute(
        select(User, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.user_id == User.id)
        .order_by(User.created_at.desc())
    ).all()
    plans = billing.current_plans([user.id for user, _ in rows])
    return [account_read(user, n, plans.get(user.id)) for user, n in rows]


@router.post("/accounts/{user_id}/disable", response_model=AccountRead)
def disable_account(user_id: UUID, owner: Owner, auth: Auth, billing: Billing) -> AccountRead:
    """Sign the account out and keep it from signing in. Its data is kept."""
    user = auth.set_disabled(user_id, disabled=True)
    record(auth.db, owner, AdminActionKind.ACCOUNT_DISABLE, "done", account_id=user_id)
    return one_account(billing, user)


@router.post("/accounts/{user_id}/enable", response_model=AccountRead)
def enable_account(user_id: UUID, owner: Owner, auth: Auth, billing: Billing) -> AccountRead:
    user = auth.set_disabled(user_id, disabled=False)
    record(auth.db, owner, AdminActionKind.ACCOUNT_ENABLE, "done", account_id=user_id)
    return one_account(billing, user)


# --- billing ---------------------------------------------------------------------------------


@router.get("/billing/summary", response_model=BillingSummary)
def billing_summary(_: Owner, billing: Billing, response: Response) -> BillingSummary:
    """Accounts by plan, periods, payments by status, and totals from verified payments only
    (test mode)."""
    response.headers["Cache-Control"] = NO_STORE
    return billing.summary()


@router.get("/billing/lookup", response_model=LookupResult)
def billing_lookup(
    owner: Owner,
    billing: Billing,
    response: Response,
    q: Annotated[str, Query(min_length=1, max_length=254)],
) -> LookupResult:
    """The account an email address, Thread payment id, or Razorpay payment or order id
    belongs to. Recorded without the search text."""
    response.headers["Cache-Control"] = NO_STORE
    return LookupResult(account_id=billing.lookup(owner, q))


@router.get("/accounts/{user_id}/billing", response_model=AdminAccountBilling)
def account_billing(
    user_id: UUID, _: Owner, billing: Billing, response: Response
) -> AdminAccountBilling:
    """One account's plan and periods, as its holder sees them."""
    response.headers["Cache-Control"] = NO_STORE
    user = billing.user(user_id)
    return AdminAccountBilling(account=one_account(billing, user), billing=billing.account(user))


@router.get("/accounts/{user_id}/payments", response_model=PaymentPage)
def account_payments(
    user_id: UUID,
    _: Owner,
    billing: Billing,
    response: Response,
    before: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> PaymentPage:
    """Every payment of one account, newest first, a page at a time."""
    response.headers["Cache-Control"] = NO_STORE
    return billing.payments(billing.user(user_id), before, limit)


@router.post("/accounts/{user_id}/payments/{payment_id}/check", response_model=PaymentRead)
def check_payment(
    user_id: UUID, payment_id: UUID, owner: Owner, billing: Billing, response: Response
) -> PaymentRead:
    """Ask Razorpay again about an unfinished payment or a refund in progress. Brings Thread's
    record up to date; can't move money or grant access."""
    response.headers["Cache-Control"] = NO_STORE
    return billing.check(owner, user_id, payment_id)


@router.get("/actions", response_model=list[AdminActionRead])
def recent_actions(_: Owner, billing: Billing, response: Response) -> list[AdminActionRead]:
    """The owner's most recent recorded actions."""
    response.headers["Cache-Control"] = NO_STORE
    return billing.recent()
