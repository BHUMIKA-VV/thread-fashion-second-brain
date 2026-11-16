"""M14-9: billing scenarios across the whole API, beyond what each increment's tests cover.

- A second payment on an order already settled grants nothing more, and is logged for the
  owner (money may have been taken twice).
- Every billing and admin route refuses a signed-out request, another account's records and
  (for /admin) a non-owner.
- An expired period with more pieces than Free allows: uploads are refused through the real
  route, and every piece is still there.
- Whatever status, plan or amount the browser sends, the server's records decide.
"""

import logging
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_storage
from app.core.config import Settings, get_settings
from app.main import app
from app.models import Item, Payment, User
from app.storage import LocalStorage
from tests import test_billing_checkout as checkout
from tests.conftest import make_item
from tests.images import image_bytes
from tests.test_billing_checkout import Shop, account
from tests.test_billing_dashboard import bought, cancel, me, shift

shop = checkout.shop
buyer = checkout.buyer
fake = checkout.fake
shop_settings = checkout.shop_settings

pytestmark = pytest.mark.db

DAY = timedelta(days=1)


# --- duplicate payment -----------------------------------------------------------------------


def test_a_second_payment_on_a_settled_order_grants_nothing_and_is_logged(
    db: Session, shop: Shop, buyer: User, caplog: pytest.LogCaptureFixture
) -> None:
    order = shop.order()
    first = shop.pay(order)
    assert shop.verify(first).json()["status"] == "paid"

    # Checkout reports another captured payment on the same order.
    second = shop.pay(order)
    with caplog.at_level(logging.WARNING, logger="app.services.billing"):
        again = shop.verify(second)
    assert again.status_code == 200
    assert again.json()["status"] == "paid"
    assert len(shop.periods(buyer)) == 1
    row = shop.row(order)
    assert row.provider_payment_id == first["payment_id"]  # the first one still counts
    [warning] = [r for r in caplog.records if r.levelno == logging.WARNING]
    message = warning.getMessage()
    assert str(row.id) in message and second["payment_id"] in message
    assert "refund it" in message
    # Repeating the first verification is not a second payment.
    caplog.clear()
    with caplog.at_level(logging.WARNING, logger="app.services.billing"):
        shop.verify(first)
    assert not [r for r in caplog.records if r.levelno == logging.WARNING]


# --- unauthorised access ---------------------------------------------------------------------


def test_every_billing_route_refuses_a_signed_out_request(
    db: Session, shop: Shop, buyer: User
) -> None:
    order = shop.order()
    pid, uid = order["payment_id"], buyer.id
    shop.principal = None
    for method, path, body in [
        ("GET", "/billing/account", None),
        ("GET", "/billing/payments", None),
        ("POST", "/billing/checkout", {"plan_id": "studio"}),
        ("POST", "/billing/checkout/verify", shop.pay(order)),
        ("POST", f"/billing/payments/{pid}/refresh", None),
        ("POST", f"/billing/payments/{pid}/cancel", {"confirm": True}),
        ("GET", "/admin/billing/summary", None),
        ("GET", "/admin/billing/lookup?q=pay_x", None),
        ("GET", f"/admin/accounts/{uid}/billing", None),
        ("GET", f"/admin/accounts/{uid}/payments", None),
        ("POST", f"/admin/accounts/{uid}/payments/{pid}/check", None),
        ("GET", "/admin/actions", None),
        ("GET", "/admin/accounts", None),
    ]:
        response = shop.http.request(method, path, json=body)
        assert response.status_code == 401, (method, path, response.text)
    assert shop.row(order).status == "created"


def test_another_accounts_billing_records_are_out_of_reach(
    db: Session, shop: Shop, buyer: User
) -> None:
    upcoming_owner = buyer
    open_order = shop.order()  # opened and left unpaid
    bought(shop, "studio")
    theirs = bought(shop, "studio_pro")["payment_id"]  # paid ahead: cancellable by its owner

    shop.sign_in(account(db, "Intruder"))
    for method, path, body in [
        ("GET", f"/billing/payments?before={theirs}", None),
        ("POST", f"/billing/payments/{theirs}/refresh", None),
        ("POST", f"/billing/payments/{theirs}/cancel", {"confirm": True}),
        ("POST", "/billing/checkout/verify", shop.pay(open_order)),
    ]:
        response = shop.http.request(method, path, json=body)
        assert response.status_code == 404, (method, path, response.text)
    # Nothing of theirs changed, and the intruder's own view is empty.
    assert db.get_one(Payment, theirs).status == "paid"
    assert shop.row(open_order).status == "created"
    assert shop.http.get("/billing/payments").json()["payments"] == []
    assert me(shop)["status"] == "free"
    shop.sign_in(upcoming_owner)
    assert me(shop)["upcoming"]["payment_id"] == theirs


# --- expired, with more than Free allows ------------------------------------------------------


def test_an_expired_period_over_the_free_limit_keeps_every_piece_and_refuses_uploads(
    db: Session, shop: Shop, shop_settings: Settings, buyer: User, storage: LocalStorage
) -> None:
    settings = shop_settings.model_copy(
        update={"plan_limits_from": datetime.now(UTC) - timedelta(hours=1)}
    )
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_storage] = lambda: storage
    period = bought(shop, "studio")
    for _ in range(30):
        make_item(db, buyer, file_size=1000)

    shift(db, period, ends_in=-DAY)  # Studio is over: back on Free, which holds 25
    data = image_bytes(seed=7)
    refused = shop.http.post("/items", files={"file": ("p.jpg", data, "image/jpeg")})
    assert refused.status_code == 403, refused.text
    error = refused.json()["error"]
    assert error["code"] == "quota_exceeded"
    assert "Free holds 25 pieces and you have 30" in error["message"]
    assert "Every piece you have is kept" in error["message"]

    count = select(func.count()).select_from(Item).where(Item.user_id == buyer.id)
    assert db.scalar(count) == 30
    assert me(shop)["usage"]["full"] is True
    assert me(shop)["plan_id"] == "free"

    # Buying Studio again makes room straight away.
    bought(shop, "studio")
    added = shop.http.post("/items", files={"file": ("p.jpg", data, "image/jpeg")})
    assert added.status_code == 201, added.text
    assert db.scalar(count) == 31


# --- the browser can't decide ----------------------------------------------------------------


def test_status_plan_and_amount_sent_by_the_browser_are_ignored(
    db: Session, shop: Shop, buyer: User
) -> None:
    # Checkout: the plan's own price, whatever amount is sent.
    order = shop.checkout("studio", amount_paise=1, status="paid", period_days=366).json()
    assert (order["amount_paise"], order["plan_id"]) == (99_900, "studio")

    # Verify: an authorisation stays unpaid even if the browser says it is paid, for any plan.
    body = shop.pay(order, "authorized") | {
        "status": "paid",
        "plan_id": "studio_pro",
        "amount_paise": 1,
    }
    result = shop.verify(body).json()
    assert (result["status"], result["period"]) == ("pending", None)
    assert shop.row(order).status == "created"

    # Refresh: a body claiming success changes nothing.
    refreshed = shop.http.post(
        f"/billing/payments/{order['payment_id']}/refresh", json={"status": "paid"}
    ).json()
    assert refreshed["status"] == "created"
    assert me(shop)["status"] == "free"

    # Cancel: the refund is always the full amount, never one the browser names.
    bought(shop, "studio")
    ahead = bought(shop, "studio_pro")["payment_id"]
    done = cancel(shop, ahead, confirm=True, amount_paise=1, refund="partial")
    assert done.status_code == 200, done.text
    row = db.get_one(Payment, ahead)
    db.refresh(row)
    assert (row.status, row.refunded_paise) == ("refunded", 249_900)


def test_an_unknown_payment_id_is_simply_not_found(shop: Shop, buyer: User) -> None:
    unknown = uuid4()
    assert shop.http.post(f"/billing/payments/{unknown}/refresh").status_code == 404
    assert cancel(shop, str(unknown)).status_code == 404
