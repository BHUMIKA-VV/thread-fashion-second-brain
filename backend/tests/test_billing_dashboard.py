"""M14-5: the billing dashboard's API: plan status, payment history, checking a payment again,
and cancelling a period that hasn't started (for a full refund, in test mode)."""

import dataclasses
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy.orm import Session

from app.billing.razorpay import FakeProvider, ProviderUnavailable, Refund
from app.models import Payment, Subscription, User
from tests import test_billing_checkout as checkout
from tests.test_billing_checkout import Shop, account, roughly_now

# The checkout tests' fixtures: a signed-in buyer, paying through a fresh fake provider.
shop = checkout.shop
buyer = checkout.buyer
fake = checkout.fake
shop_settings = checkout.shop_settings

pytestmark = pytest.mark.db

DAY = timedelta(days=1)


def bought(shop: Shop, plan_id: str = "studio") -> dict[str, Any]:
    response = shop.verify(shop.pay(shop.order(plan_id)))
    assert response.status_code == 200, response.text
    return response.json()["period"]


def me(shop: Shop) -> dict[str, Any]:
    return shop.http.get("/billing/account").json()


def cancel(shop: Shop, payment_id: str, **body: Any) -> Any:
    return shop.http.post(f"/billing/payments/{payment_id}/cancel", json=body or {"confirm": True})


def shift(db: Session, period: dict[str, Any], *, ends_in: timedelta) -> None:
    """Move a period so it ends `ends_in` from now (keeping its 30 days)."""
    row = db.query(Subscription).filter_by(payment_id=period["payment_id"]).one()
    row.ends_at = datetime.now(UTC) + ends_in
    row.starts_at = row.ends_at - 30 * DAY
    db.flush()


# --- status --------------------------------------------------------------------------------


def test_the_account_says_what_plan_it_is_on_and_until_when(
    db: Session, shop: Shop, buyer: User
) -> None:
    free = me(shop)
    assert (free["status"], free["plan_id"], free["current"], free["last_ended"]) == (
        "free",
        "free",
        None,
        None,
    )
    assert roughly_now(free["next_start_at"])

    period = bought(shop)
    active = me(shop)
    assert (active["status"], active["plan_id"], active["ending_soon"]) == (
        "active",
        "studio",
        False,
    )
    assert active["current"]["ends_at"] == period["ends_at"]
    assert active["next_start_at"] == period["ends_at"]

    shift(db, period, ends_in=3 * DAY)
    assert me(shop)["ending_soon"] is True
    # A period already bought to follow it means nothing is ending.
    nxt = bought(shop, "studio_pro")
    soon = me(shop)
    assert (soon["ending_soon"], soon["upcoming"]["plan_id"]) == (False, "studio_pro")
    assert soon["upcoming"]["cancellable"] is True
    assert soon["current"]["cancellable"] is False
    assert soon["next_start_at"] == nxt["ends_at"]

    shift(db, period, ends_in=-31 * DAY)
    db.query(Subscription).filter_by(payment_id=nxt["payment_id"]).delete()
    db.query(Payment).filter_by(id=nxt["payment_id"]).delete()
    db.flush()
    ended = me(shop)
    assert (ended["status"], ended["plan_id"]) == ("free", "free")
    assert (ended["last_ended"]["payment_id"], ended["last_ended"]["ended_early"]) == (
        period["payment_id"],
        False,
    )


# --- history -------------------------------------------------------------------------------


def stored(db: Session, user: User, n: int, status: str = "created") -> list[Payment]:
    base = datetime(2026, 1, 1, tzinfo=UTC)
    rows = [
        Payment(
            user_id=user.id,
            provider="razorpay",
            provider_order_id=f"order_hist{user.id.hex[:8]}{i:04d}",
            plan_id="studio",
            amount_paise=99_900,
            currency="INR",
            period_days=30,
            status=status,
            failed_at=base if status == "failed" else None,
            failure_code="GATEWAY_ERROR" if status == "failed" else None,
            created_at=base + i * DAY,
        )
        for i in range(n)
    ]
    db.add_all(rows)
    db.flush()
    return rows


def test_history_lists_every_payment_a_page_at_a_time(db: Session, shop: Shop, buyer: User) -> None:
    rows = stored(db, buyer, 25)
    stored(db, account(db, "Someone else"), 3)
    first = shop.http.get("/billing/payments").json()
    assert len(first["payments"]) == 20
    assert first["payments"][0]["id"] == str(rows[-1].id)  # newest first
    second = shop.http.get(f"/billing/payments?before={first['next_before']}").json()
    assert (len(second["payments"]), second["next_before"]) == (5, None)
    listed = {p["id"] for p in first["payments"] + second["payments"]}
    assert listed == {str(r.id) for r in rows}
    small = shop.http.get("/billing/payments?limit=10").json()
    assert len(small["payments"]) == 10
    assert shop.http.get("/billing/payments?limit=0").status_code == 422


def test_history_shows_failures_with_their_code_and_no_secrets(
    db: Session, shop: Shop, buyer: User
) -> None:
    [row] = stored(db, buyer, 1, "failed")
    [payment] = shop.http.get("/billing/payments").json()["payments"]
    assert (payment["status"], payment["failure_code"], payment["refreshable"]) == (
        "failed",
        "GATEWAY_ERROR",
        True,
    )
    assert set(payment) == {
        "id",
        "plan_id",
        "plan_name",
        "amount_paise",
        "currency",
        "status",
        "method",
        "created_at",
        "paid_at",
        "provider_payment_id",
        "refunded_paise",
        "failure_code",
        "refund",
        "refreshable",
    }
    assert row.provider_order_id not in str(payment)


def test_another_accounts_payments_are_never_listed_or_touched(
    db: Session, shop: Shop, buyer: User
) -> None:
    theirs = stored(db, account(db, "Someone else"), 1)[0]
    assert shop.http.get("/billing/payments").json()["payments"] == []
    for response in (
        shop.http.get(f"/billing/payments?before={theirs.id}"),
        shop.http.post(f"/billing/payments/{theirs.id}/refresh"),
        cancel(shop, str(theirs.id)),
    ):
        assert (response.status_code, response.json()["error"]["code"]) == (
            404,
            "payment_not_found",
        )
    assert shop.http.post("/billing/payments/not-a-uuid/refresh").status_code == 422
    shop.principal = None
    assert shop.http.get("/billing/payments").status_code == 401


# --- checking again ------------------------------------------------------------------------


def test_checking_again_settles_a_payment_captured_after_checkout_closed(
    db: Session, shop: Shop, buyer: User
) -> None:
    order = shop.order()
    pending = shop.verify(shop.pay(order, "authorized")).json()
    assert pending["status"] == "pending"
    payment_id = order["payment_id"]
    [row] = shop.http.get("/billing/payments").json()["payments"]
    assert (row["status"], row["refreshable"]) == ("created", True)

    still = shop.http.post(f"/billing/payments/{payment_id}/refresh").json()
    assert still["status"] == "created"
    # Razorpay captured it later (here: another attempt on the order went through).
    shop.fake.pay(order["order_id"], "captured")
    paid = shop.http.post(f"/billing/payments/{payment_id}/refresh").json()
    assert (paid["status"], paid["refreshable"]) == ("paid", False)
    assert me(shop)["status"] == "active"
    assert len(shop.periods(buyer)) == 1
    # A settled payment is just shown again.
    assert shop.http.post(f"/billing/payments/{payment_id}/refresh").json() == paid


def test_checking_again_is_rate_limited(
    db: Session, shop: Shop, buyer: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.services.billing as service

    monkeypatch.setattr(service, "REFRESH_PER_HOUR", 2)
    payment_id = shop.order()["payment_id"]
    url = f"/billing/payments/{payment_id}/refresh"
    assert [shop.http.post(url).status_code for _ in range(2)] == [200, 200]
    assert shop.http.post(url).status_code == 429


# --- cancelling ----------------------------------------------------------------------------


def test_a_period_that_has_not_started_can_be_cancelled_for_a_full_refund(
    db: Session, shop: Shop, buyer: User
) -> None:
    current = bought(shop)
    upcoming = bought(shop, "studio_pro")

    # Only after an explicit confirmation.
    assert cancel(shop, upcoming["payment_id"], confirm=False).status_code == 422
    assert shop.http.post(f"/billing/payments/{upcoming['payment_id']}/cancel").status_code == 422

    done = cancel(shop, upcoming["payment_id"])
    assert done.status_code == 200, done.text
    result = done.json()
    assert result["refund"] == "processed"
    assert result["account"]["upcoming"] is None
    assert result["account"]["current"]["payment_id"] == current["payment_id"]

    refunded = db.get_one(Payment, upcoming["payment_id"])
    db.refresh(refunded)
    assert (refunded.status, refunded.refunded_paise) == ("refunded", 249_900)
    period = db.query(Subscription).filter_by(payment_id=upcoming["payment_id"]).one()
    db.refresh(period)
    assert (period.status, period.cancel_reason) == ("cancelled", "refund")
    history = shop.http.get("/billing/payments").json()["payments"]
    assert [p["refund"] for p in history] == ["full", "none"]  # kept, never deleted

    # Twice is refused; so is the period that is running; the slot is free again.
    assert cancel(shop, upcoming["payment_id"]).json()["error"]["code"] == "not_cancellable"
    assert cancel(shop, current["payment_id"]).json()["error"]["code"] == "not_cancellable"
    assert bought(shop, "studio")["starts_at"] == current["ends_at"]


def test_a_refund_razorpay_has_not_finished_is_shown_as_requested(
    db: Session, shop: Shop, buyer: User, fake: FakeProvider
) -> None:
    bought(shop)
    upcoming = bought(shop)
    fake.refund_outcome = "pending"
    result = cancel(shop, upcoming["payment_id"]).json()
    assert (result["refund"], result["account"]["upcoming"]) == ("pending", None)
    row = next(
        p
        for p in shop.http.get("/billing/payments").json()["payments"]
        if p["id"] == upcoming["payment_id"]
    )
    assert (row["status"], row["refund"], row["refreshable"]) == ("paid", "requested", True)

    # Razorpay finishes the refund; checking again records it.
    payment_id = db.get_one(Payment, upcoming["payment_id"]).provider_payment_id
    assert payment_id is not None
    fake._payments[payment_id] = dataclasses.replace(
        fake._payments[payment_id], refunded_paise=99_900, status="refunded"
    )
    checked = shop.http.post(f"/billing/payments/{upcoming['payment_id']}/refresh").json()
    assert (checked["status"], checked["refund"], checked["refreshable"]) == (
        "refunded",
        "full",
        False,
    )


def test_a_retried_cancel_reuses_the_refund_already_made(
    db: Session, shop: Shop, buyer: User, fake: FakeProvider
) -> None:
    bought(shop)
    upcoming = bought(shop)
    made: list[Refund] = []
    real = fake.refund

    def counted(*args: Any) -> Refund:
        made.append(real(*args))
        return made[-1]

    fake.refund = counted  # type: ignore[method-assign]
    # Razorpay made the refund, but the answer never arrived.
    real_list = fake.payment_refunds

    def lost_answer(payment_id: str) -> list[Refund]:
        fake.refund = real  # type: ignore[method-assign]
        counted(payment_id, 99_900, f"thr_rf_{upcoming['payment_id'].replace('-', '')}")
        raise ProviderUnavailable("timed out")

    fake.payment_refunds = lost_answer  # type: ignore[method-assign]
    failed = cancel(shop, upcoming["payment_id"])
    assert failed.status_code == 503
    assert me(shop)["upcoming"] is not None  # nothing changed in Thread

    fake.payment_refunds = real_list  # type: ignore[method-assign]
    assert cancel(shop, upcoming["payment_id"]).json()["refund"] == "processed"
    assert len(made) == 1  # one refund at Razorpay, not two


def test_the_owner_and_unconfigured_payments_cannot_cancel(db: Session, shop: Shop) -> None:
    shop.sign_in(account(db), owner=True)
    refused = cancel(shop, "00000000-0000-4000-8000-000000000009")
    assert (refused.status_code, refused.json()["error"]["code"]) == (403, "owner_exempt")
    shop.sign_in(account(db))
    shop.set_provider(None)  # type: ignore[attr-defined]
    refused = cancel(shop, "00000000-0000-4000-8000-000000000009")
    assert (refused.status_code, refused.json()["error"]["code"]) == (
        503,
        "payments_not_configured",
    )
