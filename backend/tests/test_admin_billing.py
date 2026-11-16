"""M14-7: the owner's billing views and the one support action, all owner-only and recorded.

Figures come from verified payments only; the owner can look an account up and see its
billing as its holder does, and ask Razorpay again about one payment. Nothing here can
refund, cancel or grant a period.
"""

from datetime import timedelta
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AdminAction, Payment, User
from tests import test_billing_checkout as checkout
from tests.test_billing_checkout import Shop, account
from tests.test_billing_dashboard import bought, cancel, shift

shop = checkout.shop
buyer = checkout.buyer
fake = checkout.fake
shop_settings = checkout.shop_settings

pytestmark = pytest.mark.db

DAY = timedelta(days=1)


@pytest.fixture
def owner(db: Session) -> User:
    user = account(db, "Owner")
    user.is_owner = True
    db.flush()
    return user


def as_owner(shop: Shop, owner: User) -> Shop:
    return shop.sign_in(owner, owner=True)


def actions(db: Session) -> list[AdminAction]:
    db.expire_all()
    return list(db.scalars(select(AdminAction).order_by(AdminAction.created_at, AdminAction.id)))


def get(shop: Shop, path: str, **params: Any) -> Any:
    response = shop.http.get(path, params=params)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    return response.json()


# --- owner-only ------------------------------------------------------------------------------


def test_every_billing_route_is_owner_only(shop: Shop, buyer: User) -> None:
    payment_id = shop.order()["payment_id"]
    base = f"/admin/accounts/{buyer.id}"
    for method, path in [
        ("GET", "/admin/billing/summary"),
        ("GET", "/admin/billing/lookup?q=pay_x"),
        ("GET", f"{base}/billing"),
        ("GET", f"{base}/payments"),
        ("POST", f"{base}/payments/{payment_id}/check"),
        ("GET", "/admin/actions"),
    ]:
        response = shop.http.request(method, path)
        assert response.status_code == 403, path
        assert response.json()["error"]["code"] == "owner_only"
    shop.principal = None
    assert shop.http.get("/admin/billing/summary").status_code == 401


# --- figures ---------------------------------------------------------------------------------


def test_the_summary_counts_plans_periods_and_verified_money_only(
    db: Session, shop: Shop, buyer: User, owner: User
) -> None:
    bought(shop, "studio")  # Studio now

    pro = account(db, "Pro")
    shop.sign_in(pro)
    bought(shop, "studio_pro")
    ahead = bought(shop, "studio")  # paid ahead, then cancelled for a refund
    assert cancel(shop, ahead["payment_id"]).status_code == 200

    lapsed = account(db, "Lapsed")
    shop.sign_in(lapsed)
    shift(db, bought(shop, "studio"), ends_in=-DAY)  # ended: back on Free

    browser = account(db, "Browser")
    shop.sign_in(browser)
    shop.order("studio_pro")  # opened, never paid
    failed = shop.order("studio")
    shop.verify(shop.pay(failed, "failed"))
    # A forged confirmation is refused and adds nothing.
    forged = shop.order("studio_pro")
    body = shop.pay(forged) | {"signature": "0" * 64}
    assert shop.verify(body).status_code == 400

    summary = get(as_owner(shop, owner), "/admin/billing/summary")
    assert summary["accounts"] == {"free": 2, "studio": 1, "studio_pro": 1}
    assert (summary["paid_ahead"], summary["ended"]) == (0, 1)
    assert (summary["cancelled_refund"], summary["cancelled_owner"]) == (1, 0)
    assert summary["payments"] == {
        "unfinished": 2,  # the order never paid, and the forged one
        "paid": 3,
        "failed": 1,
        "refunded": 1,
        "refund_requested": 0,
    }
    paid = 99_900 + 249_900 + 99_900 + 99_900
    assert summary["totals"] == {
        "paid_paise": paid,
        "refunded_paise": 99_900,
        "net_paise": paid - 99_900,
    }
    assert (summary["mode"], summary["provider"]) == ("test", "fake")


def test_the_account_list_shows_each_plan(
    db: Session, shop: Shop, buyer: User, owner: User
) -> None:
    period = bought(shop, "studio_pro")
    rows = {a["id"]: a for a in get(as_owner(shop, owner), "/admin/accounts")}
    assert rows[str(buyer.id)]["plan_id"] == "studio_pro"
    assert rows[str(buyer.id)]["plan_until"].startswith(period["ends_at"][:16])
    assert (rows[str(owner.id)]["plan_id"], rows[str(owner.id)]["plan_until"]) == ("free", None)


# --- lookup and one account ------------------------------------------------------------------


def test_lookup_finds_an_account_by_email_and_by_each_kind_of_id(
    db: Session, shop: Shop, buyer: User, owner: User
) -> None:
    buyer.email = "Buyer@Example.com"
    db.flush()
    order = shop.order()
    shop.verify(shop.pay(order))
    row = shop.row(order)
    as_owner(shop, owner)

    for query in [
        "buyer@example.com",
        str(row.provider_payment_id),
        row.provider_order_id,
        str(row.id),
        str(buyer.id),
        f"  {row.provider_order_id}  ",
    ]:
        assert get(shop, "/admin/billing/lookup", q=query) == {"account_id": str(buyer.id)}

    missing = shop.http.get("/admin/billing/lookup", params={"q": "nobody@example.com"})
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "not_found"

    recorded = actions(db)
    assert [a.outcome for a in recorded] == ["found"] * 6 + ["not_found"]
    assert {a.account_id for a in recorded[:6]} == {buyer.id}
    # Ids and a short outcome only: never the search text or an email address.
    for a in recorded:
        values = " ".join(str(v) for v in (a.action, a.account_id, a.payment_id, a.outcome))
        assert "@" not in values and "example" not in values


def test_the_owner_sees_an_accounts_billing_as_its_holder_does(
    db: Session, shop: Shop, buyer: User, owner: User
) -> None:
    holder_view = None
    period = bought(shop, "studio")
    holder_view = shop.http.get("/billing/account").json()
    holder_payments = shop.http.get("/billing/payments").json()

    as_owner(shop, owner)
    view = get(shop, f"/admin/accounts/{buyer.id}/billing")
    assert view["account"]["id"] == str(buyer.id)
    assert view["account"]["plan_id"] == "studio"
    assert view["billing"] == holder_view
    assert view["billing"]["current"]["payment_id"] == period["payment_id"]
    assert get(shop, f"/admin/accounts/{buyer.id}/payments") == holder_payments

    from uuid import uuid4

    assert shop.http.get(f"/admin/accounts/{uuid4()}/billing").status_code == 404


# --- the support action ----------------------------------------------------------------------


def test_checking_with_razorpay_settles_only_what_razorpay_confirms(
    db: Session, shop: Shop, buyer: User, owner: User
) -> None:
    order = shop.order()
    shop.verify(shop.pay(order, "authorized"))
    url = f"/admin/accounts/{buyer.id}/payments/{order['payment_id']}/check"
    as_owner(shop, owner)

    still = shop.http.post(url)
    assert still.status_code == 200, still.text
    assert still.json()["status"] == "created"
    assert shop.periods(buyer) == []

    shop.fake.pay(order["order_id"], "captured")  # Razorpay captured it later
    paid = shop.http.post(url).json()
    assert paid["status"] == "paid"
    assert len(shop.periods(buyer)) == 1
    assert shop.http.post(url).json() == paid  # settled: nothing more to do

    assert [(a.action, a.outcome) for a in actions(db)] == [
        ("payment_check", "no_change"),
        ("payment_check", "updated"),
        ("payment_check", "no_change"),
    ]
    assert {(a.actor_id, a.account_id) for a in actions(db)} == {(owner.id, buyer.id)}


def test_checking_another_accounts_payment_is_refused_and_recorded(
    db: Session, shop: Shop, buyer: User, owner: User
) -> None:
    payment_id = shop.order()["payment_id"]
    other = account(db, "Other")
    as_owner(shop, owner)
    response = shop.http.post(f"/admin/accounts/{other.id}/payments/{payment_id}/check")
    assert response.status_code == 404
    [recorded] = actions(db)
    assert (recorded.account_id, recorded.payment_id, recorded.outcome) == (
        other.id,
        None,
        "not_found",
    )
    assert db.get_one(Payment, payment_id).status == "created"


def test_without_payment_keys_a_check_changes_nothing_and_says_so(
    db: Session, shop: Shop, buyer: User, owner: User
) -> None:
    payment_id = shop.order()["payment_id"]
    shop.set_provider(None)  # type: ignore[attr-defined]
    as_owner(shop, owner)
    response = shop.http.post(f"/admin/accounts/{buyer.id}/payments/{payment_id}/check")
    assert response.status_code == 503
    assert [a.outcome for a in actions(db)] == ["unavailable"]


# --- the record ------------------------------------------------------------------------------


def test_disabling_and_enabling_are_recorded_and_listed_newest_first(
    db: Session, shop: Shop, buyer: User, owner: User
) -> None:
    as_owner(shop, owner)
    assert shop.http.post(f"/admin/accounts/{buyer.id}/disable").json()["disabled"] is True
    assert shop.http.post(f"/admin/accounts/{buyer.id}/enable").json()["disabled"] is False
    # The owner account can't be disabled, and a refusal isn't recorded as done.
    assert shop.http.post(f"/admin/accounts/{owner.id}/disable").status_code == 403

    listed = get(shop, "/admin/actions")
    assert [(a["action"], a["outcome"]) for a in listed] == [
        ("account_enable", "done"),
        ("account_disable", "done"),
    ]
    assert listed[0]["account_name"] == "Buyer"
    assert listed[0]["account_id"] == str(buyer.id)
