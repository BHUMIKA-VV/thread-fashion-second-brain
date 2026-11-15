"""M14-6: plan limits, decided in one place on the server (services/entitlements.py).

The plan comes only from verified paid periods; an ended or refunded period falls back to
Free; accounts keep the limits they had before plans until plan limits start (and, after
that, if they were made earlier); and nothing in an archive is touched by a plan change.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import Item, Subscription, User
from app.services.auth import AuthRefused, Principal
from app.services.entitlements import EntitlementService
from tests import test_billing_checkout as checkout
from tests.conftest import make_item
from tests.test_billing_checkout import Shop
from tests.test_billing_dashboard import bought, me, shift

shop = checkout.shop
buyer = checkout.buyer
fake = checkout.fake
shop_settings = checkout.shop_settings

pytestmark = pytest.mark.db

MB = 1024**2
DAY = timedelta(days=1)


def limits_from(settings: Settings, when: datetime | None) -> Settings:
    return settings.model_copy(update={"plan_limits_from": when})


def started(settings: Settings) -> Settings:
    """Plan limits started an hour ago: the buyer, made just now, gets its plan's limits."""
    return limits_from(settings, datetime.now(UTC) - timedelta(hours=1))


def of(user: User, *, owner: bool = False) -> Principal:
    return Principal(user.id, is_owner=owner, email_verified=True)


def entitlement(db: Session, settings: Settings, user: User, **kw: Any) -> Any:
    return EntitlementService(db, settings).for_account(of(user, **kw))


def refused(db: Session, settings: Settings, user: User, incoming: int = 1) -> str:
    with pytest.raises(AuthRefused) as caught:
        EntitlementService(db, settings).check_upload(of(user), incoming)
    assert (caught.value.code, caught.value.status_code) == ("quota_exceeded", 403)
    return caught.value.message


def fill(db: Session, user: User, n: int, file_size: int = 1000) -> None:
    for _ in range(n):
        make_item(db, user, file_size=file_size)


def pieces(db: Session, user: User) -> int:
    return db.scalar(select(func.count()).select_from(Item).where(Item.user_id == user.id)) or 0


# --- which limits apply --------------------------------------------------------------------


def test_until_plan_limits_start_every_account_keeps_its_earlier_limits(
    db: Session, shop_settings: Settings, buyer: User
) -> None:
    ent = entitlement(db, limits_from(shop_settings, None), buyer)
    assert (ent.plan_id, ent.max_pieces, ent.max_bytes) == ("free", 100, 250 * MB)
    assert ent.legacy is True
    # A start date still to come changes nothing yet.
    later = limits_from(shop_settings, datetime.now(UTC) + DAY)
    assert entitlement(db, later, buyer).max_pieces == 100


def test_accounts_made_after_limits_start_get_their_plans_limits(
    db: Session, shop: Shop, shop_settings: Settings, buyer: User
) -> None:
    settings = started(shop_settings)
    ent = entitlement(db, settings, buyer)
    assert (ent.plan_id, ent.max_pieces, ent.max_bytes, ent.legacy) == ("free", 25, 250 * MB, False)

    bought(shop, "studio")
    ent = entitlement(db, settings, buyer)
    assert (ent.plan_id, ent.max_pieces, ent.max_bytes) == ("studio", 100, 250 * MB)


def test_studio_pro_gives_the_most_room(
    db: Session, shop: Shop, shop_settings: Settings, buyer: User
) -> None:
    bought(shop, "studio_pro")
    ent = entitlement(db, started(shop_settings), buyer)
    assert (ent.plan_id, ent.max_pieces, ent.max_bytes) == ("studio_pro", 250, 1024 * MB)


def test_accounts_made_before_limits_start_keep_the_larger_of_the_two(
    db: Session, shop: Shop, shop_settings: Settings, buyer: User
) -> None:
    buyer.created_at = datetime.now(UTC) - 10 * DAY
    db.flush()
    settings = limits_from(shop_settings, datetime.now(UTC) - DAY)
    ent = entitlement(db, settings, buyer)
    assert (ent.plan_id, ent.max_pieces, ent.max_bytes, ent.legacy) == ("free", 100, 250 * MB, True)

    bought(shop, "studio_pro")
    ent = entitlement(db, settings, buyer)
    assert (ent.max_pieces, ent.max_bytes, ent.legacy) == (250, 1024 * MB, False)


def test_the_owner_has_no_limits(db: Session, shop_settings: Settings, buyer: User) -> None:
    fill(db, buyer, 3, file_size=300 * MB)
    settings = started(shop_settings)
    ent = entitlement(db, settings, buyer, owner=True)
    assert (ent.exempt, ent.max_pieces, ent.max_bytes, ent.pieces) == (True, None, None, 3)
    EntitlementService(db, settings).check_upload(of(buyer, owner=True), 10 * MB)


# --- the plan comes only from verified, current periods --------------------------------------


def test_an_ended_period_falls_back_to_free(
    db: Session, shop: Shop, shop_settings: Settings, buyer: User
) -> None:
    period = bought(shop, "studio")
    shift(db, period, ends_in=-DAY)
    assert entitlement(db, started(shop_settings), buyer).plan_id == "free"


def test_a_cancelled_period_falls_back_to_free(
    db: Session, shop: Shop, shop_settings: Settings, buyer: User
) -> None:
    period = bought(shop, "studio_pro")
    row = db.scalars(select(Subscription).filter_by(payment_id=period["payment_id"])).one()
    row.status, row.cancel_reason, row.cancelled_at = "cancelled", "refund", datetime.now(UTC)
    db.flush()
    assert entitlement(db, started(shop_settings), buyer).plan_id == "free"


def test_an_unverified_or_unpaid_order_grants_no_room(
    db: Session, shop: Shop, shop_settings: Settings, buyer: User
) -> None:
    order = shop.order("studio_pro")
    shop.verify(shop.pay(order, "authorized"))  # authorised only: not captured, not paid
    assert entitlement(db, started(shop_settings), buyer).plan_id == "free"
    # A period paid for but not started yet doesn't count until it starts.
    bought(shop, "studio")
    bought(shop, "studio_pro")
    assert me(shop)["upcoming"]["plan_id"] == "studio_pro"
    assert entitlement(db, started(shop_settings), buyer).plan_id == "studio"


# --- over the limit: refused, and nothing is touched --------------------------------------------


def test_a_downgrade_keeps_every_piece_and_only_stops_new_ones(
    db: Session, shop: Shop, shop_settings: Settings, buyer: User
) -> None:
    settings = started(shop_settings)
    app.dependency_overrides[get_settings] = lambda: settings  # the shop fixture clears it
    period = bought(shop, "studio")
    fill(db, buyer, 30)
    EntitlementService(db, settings).check_upload(of(buyer), 1000)  # room on Studio

    shift(db, period, ends_in=-DAY)  # Studio ended: back on Free, which holds 25
    message = refused(db, settings, buyer)
    assert message == (
        "Your archive is full: Free holds 25 pieces and you have 30. Every piece you have is "
        "kept. Delete a piece, or buy a period of Studio, to add another."
    )
    assert pieces(db, buyer) == 30

    usage = me(shop)["usage"]
    assert usage == {
        "pieces": 30,
        "max_pieces": 25,
        "bytes_used": 30_000,
        "max_bytes": 250 * MB,
        "earlier_limits": False,
        "full": True,
    }

    # Deleting down to under the limit makes room again.
    for item in db.scalars(select(Item).where(Item.user_id == buyer.id).limit(6)):
        db.delete(item)
    db.flush()
    EntitlementService(db, settings).check_upload(of(buyer), 1000)


def test_storage_is_limited_too(db: Session, shop_settings: Settings, buyer: User) -> None:
    settings = started(shop_settings)
    fill(db, buyer, 1, file_size=250 * MB - 10)
    assert "250 MB storage limit" in refused(db, settings, buyer, incoming=11)
    EntitlementService(db, settings).check_upload(of(buyer), 10)


def test_the_largest_plan_suggests_only_deleting(
    db: Session, shop: Shop, shop_settings: Settings, buyer: User
) -> None:
    settings = started(shop_settings).model_copy(
        update={"plan_free_pieces": 2, "plan_studio_pieces": 2, "plan_studio_pro_pieces": 2}
    )
    bought(shop, "studio_pro")
    fill(db, buyer, 2)
    assert refused(db, settings, buyer).endswith(
        "Every piece you have is kept. Delete a piece to add another."
    )


def test_the_billing_page_shows_usage_and_the_catalogue_says_when_limits_start(
    db: Session, shop: Shop, buyer: User
) -> None:
    fill(db, buyer, 2, file_size=5 * MB)
    usage = me(shop)["usage"]
    assert (usage["pieces"], usage["bytes_used"], usage["max_pieces"]) == (2, 10 * MB, 100)
    assert (usage["earlier_limits"], usage["full"]) == (True, False)

    limits = shop.http.get("/billing/plans").json()["limits"]
    assert limits == {"starts_at": None, "earlier_pieces": 100, "earlier_bytes": 250 * MB}
