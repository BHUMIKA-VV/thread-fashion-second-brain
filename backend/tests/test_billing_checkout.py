"""M14-3: buying a period through checkout, and what the server refuses to believe.

Razorpay is replaced by the in-memory FakeProvider (a fresh one per test), which signs its
payments with its own fixed secret, exactly as Razorpay signs with the key secret.
"""

import dataclasses
from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.routes.billing import get_payment_provider
from app.billing.razorpay import FakeProvider, ProviderPayment, ProviderUnavailable
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.main import app
from app.models import Payment, Subscription, User
from app.services.auth import Principal

pytestmark = pytest.mark.db

DAY = timedelta(days=1)


def account(db: Session, name: str = "Buyer") -> User:
    user = User(display_name=name)
    db.add(user)
    db.flush()
    return user


class Shop:
    """An HTTP client on the test database, signed in as `principal`, paying through `fake`."""

    def __init__(self, client: TestClient, fake: FakeProvider, db: Session) -> None:
        self.http = client
        self.fake = fake
        self.db = db
        self.principal: Principal | None = None

    def sign_in(self, user: User, *, owner: bool = False, verified: bool = True) -> "Shop":
        self.principal = Principal(user.id, is_owner=owner, email_verified=verified)
        return self

    def checkout(self, plan_id: str = "studio", **extra: Any) -> Any:
        return self.http.post("/billing/checkout", json={"plan_id": plan_id, **extra})

    def order(self, plan_id: str = "studio") -> dict[str, Any]:
        response = self.checkout(plan_id)
        assert response.status_code == 201, response.text
        return response.json()

    def pay(self, order: dict[str, Any], outcome: str = "captured") -> dict[str, str]:
        payment = self.fake.pay(order["order_id"], outcome)  # type: ignore[arg-type]
        return self.signed(order["order_id"], payment.id)

    def signed(self, order_id: str, payment_id: str) -> dict[str, str]:
        return {
            "order_id": order_id,
            "payment_id": payment_id,
            "signature": self.fake.sign(order_id, payment_id),
        }

    def verify(self, body: dict[str, str]) -> Any:
        return self.http.post("/billing/checkout/verify", json=body)

    def row(self, order: dict[str, Any]) -> Payment:
        self.db.expire_all()
        return self.db.scalars(
            select(Payment).where(Payment.provider_order_id == order["order_id"])
        ).one()

    def periods(self, user: User) -> list[Subscription]:
        self.db.expire_all()
        return list(
            self.db.scalars(
                select(Subscription)
                .where(Subscription.user_id == user.id)
                .order_by(Subscription.starts_at)
            )
        )


@pytest.fixture
def fake() -> FakeProvider:
    return FakeProvider()


@pytest.fixture
def shop_settings() -> Settings:
    return get_settings()


@pytest.fixture
def shop(db: Session, fake: FakeProvider, shop_settings: Settings) -> Iterator[Shop]:
    holder: dict[str, Any] = {"provider": fake}
    with TestClient(app, raise_server_exceptions=False) as client:
        store = Shop(client, fake, db)

        def principal() -> Principal:
            if store.principal is None:
                from fastapi import HTTPException

                raise HTTPException(status_code=401, detail="not_signed_in")
            return store.principal

        app.dependency_overrides.update(
            {
                get_db: lambda: db,
                get_current_user: principal,
                get_payment_provider: lambda: holder["provider"],
                get_settings: lambda: shop_settings,
            }
        )
        store.set_provider = lambda p: holder.__setitem__("provider", p)  # type: ignore[attr-defined]
        yield store
    app.dependency_overrides.clear()


@pytest.fixture
def buyer(db: Session, shop: Shop) -> User:
    user = account(db)
    shop.sign_in(user)
    return user


def roughly_now(value: str) -> bool:
    return abs(datetime.fromisoformat(value) - datetime.now(UTC)) < timedelta(minutes=1)


# --- starting a checkout -------------------------------------------------------------------


def test_an_order_is_made_at_the_catalogue_price_and_grants_nothing(
    shop: Shop, buyer: User
) -> None:
    # Whatever amount the browser sends is ignored: only the plan is read.
    response = shop.checkout("studio", amount_paise=100, amount=100)
    assert response.status_code == 201
    order = response.json()
    assert (order["amount_paise"], order["currency"], order["plan_id"]) == (99_900, "INR", "studio")
    assert order["key_id"].startswith("rzp_test_")
    assert response.headers["cache-control"] == "no-store"
    row = shop.row(order)
    assert (row.status, row.amount_paise, row.period_days, row.user_id) == (
        "created",
        99_900,
        30,
        buyer.id,
    )
    assert str(row.id) == order["payment_id"]
    assert shop.periods(buyer) == []

    pro = shop.order("studio_pro")
    assert pro["amount_paise"] == 249_900


@pytest.mark.parametrize("plan_id", ["free", "enterprise", "", "STUDIO"])
def test_only_paid_plans_can_be_bought(shop: Shop, buyer: User, plan_id: str) -> None:
    assert shop.checkout(plan_id).status_code == 422


def test_the_owner_unverified_and_signed_out_accounts_cannot_buy(db: Session, shop: Shop) -> None:
    shop.sign_in(account(db), owner=True)
    refused = shop.checkout()
    assert (refused.status_code, refused.json()["error"]["code"]) == (403, "owner_exempt")
    shop.sign_in(account(db), verified=False)
    refused = shop.checkout()
    assert (refused.status_code, refused.json()["error"]["code"]) == (403, "email_not_verified")
    shop.principal = None
    assert shop.checkout().status_code == 401
    assert shop.http.get("/billing/account").status_code == 401
    assert db.scalar(select(func.count()).select_from(Payment)) == 0


def test_without_payment_keys_nothing_can_be_bought(shop: Shop, buyer: User) -> None:
    shop.set_provider(None)  # type: ignore[attr-defined]
    refused = shop.checkout()
    assert (refused.status_code, refused.json()["error"]["code"]) == (
        503,
        "payments_not_configured",
    )
    assert shop.http.get("/billing/account").json()["checkout"]["available"] is False


def test_an_order_with_another_amount_from_the_provider_is_not_recorded(
    db: Session, shop: Shop, buyer: User, fake: FakeProvider
) -> None:
    real = fake.create_order

    def cheaper(amount_paise: int, *args: Any, **kwargs: Any) -> Any:
        return dataclasses.replace(real(amount_paise, *args, **kwargs), amount_paise=100)

    fake.create_order = cheaper  # type: ignore[method-assign]
    refused = shop.checkout()
    assert (refused.status_code, refused.json()["error"]["code"]) == (502, "payment_provider_error")
    assert db.scalar(select(func.count()).select_from(Payment)) == 0


def test_starting_checkouts_is_rate_limited(
    shop: Shop, buyer: User, shop_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(shop_settings, "checkout_limit_per_hour", 2)
    assert [shop.checkout().status_code for _ in range(2)] == [201, 201]
    limited = shop.checkout()
    assert limited.status_code == 429
    assert int(limited.headers["retry-after"]) > 0


# --- verifying a payment -------------------------------------------------------------------


def test_a_captured_payment_grants_one_period_once(shop: Shop, buyer: User) -> None:
    order = shop.order()
    body = shop.pay(order)
    paid = shop.verify(body)
    assert paid.status_code == 200, paid.text
    result = paid.json()
    assert result["status"] == "paid"
    period = result["period"]
    assert period["plan_id"] == "studio"
    assert roughly_now(period["starts_at"])
    assert datetime.fromisoformat(period["ends_at"]) - datetime.fromisoformat(
        period["starts_at"]
    ) == timedelta(days=30)

    row = shop.row(order)
    assert (row.status, row.provider_payment_id, row.method) == ("paid", body["payment_id"], "upi")
    assert row.paid_at is not None

    # Verifying again (a double click, a retried request) changes nothing.
    again = shop.verify(body)
    assert again.json() == result
    assert len(shop.periods(buyer)) == 1

    me = shop.http.get("/billing/account").json()
    assert me["plan_id"] == "studio"
    assert me["current"]["ends_at"] == period["ends_at"]
    assert [p["status"] for p in me["payments"]] == ["paid"]


def test_a_forged_signature_is_refused_and_changes_nothing(shop: Shop, buyer: User) -> None:
    order = shop.order()
    body = shop.pay(order)
    for signature in ("0" * 64, shop.fake.sign(order["order_id"], "pay_other123")):
        refused = shop.verify({**body, "signature": signature})
        assert (refused.status_code, refused.json()["error"]["code"]) == (400, "signature_invalid")
    assert shop.row(order).status == "created"
    assert shop.periods(buyer) == []


@pytest.mark.parametrize(
    "body",
    [
        {"order_id": "order_x", "payment_id": "pay_x", "signature": "short"},
        {"order_id": "order_x", "payment_id": "x", "signature": "0" * 64},
        {"order_id": "../x", "payment_id": "pay_x", "signature": "0" * 64},
        {"order_id": "order_x", "payment_id": "pay_x"},
    ],
)
def test_malformed_verifications_are_refused(shop: Shop, buyer: User, body: dict[str, str]) -> None:
    assert shop.verify(body).status_code == 422


def test_another_accounts_order_reads_as_not_found(db: Session, shop: Shop, buyer: User) -> None:
    order = shop.order()
    body = shop.pay(order)
    shop.sign_in(account(db, "Someone else"))
    refused = shop.verify(body)
    assert (refused.status_code, refused.json()["error"]["code"]) == (404, "payment_not_found")
    assert shop.row(order).status == "created"
    assert shop.periods(buyer) == []


def test_an_authorized_payment_grants_nothing_yet(shop: Shop, buyer: User) -> None:
    order = shop.order()
    pending = shop.verify(shop.pay(order, "authorized"))
    assert pending.json() == {"status": "pending", "period": None, "failure_code": None}
    assert shop.row(order).status == "created"
    assert shop.periods(buyer) == []
    assert shop.http.get("/billing/account").json()["plan_id"] == "free"


def test_a_failed_attempt_is_recorded_and_a_later_success_on_the_order_counts(
    shop: Shop, buyer: User
) -> None:
    order = shop.order()
    failed = shop.verify(shop.pay(order, "failed")).json()
    assert failed == {"status": "failed", "period": None, "failure_code": "BAD_REQUEST_ERROR"}
    row = shop.row(order)
    assert (row.status, row.failure_code, row.failed_at is not None) == (
        "failed",
        "BAD_REQUEST_ERROR",
        True,
    )
    # Razorpay keeps Checkout open after a failure; the next attempt went through.
    paid = shop.verify(shop.pay(order)).json()
    assert paid["status"] == "paid"
    row = shop.row(order)
    assert (row.status, row.failed_at, row.failure_code) == ("paid", None, None)


@pytest.mark.parametrize(
    "change",
    [
        {"amount_paise": 100},
        {"currency": "USD"},
        {"order_id": "order_someotherorder"},
    ],
)
def test_a_payment_that_does_not_match_the_order_is_refused(
    shop: Shop, buyer: User, fake: FakeProvider, change: dict[str, Any]
) -> None:
    order = shop.order()
    body = shop.pay(order)
    real = fake.fetch_payment

    def tampered(payment_id: str) -> ProviderPayment:
        return dataclasses.replace(real(payment_id), **change)

    fake.fetch_payment = tampered  # type: ignore[method-assign]
    refused = shop.verify(body)
    assert (refused.status_code, refused.json()["error"]["code"]) == (400, "payment_mismatch")
    assert shop.row(order).status == "created"
    assert shop.periods(buyer) == []


def test_a_payment_from_another_order_is_refused(shop: Shop, buyer: User) -> None:
    first, second = shop.order(), shop.order()
    other = shop.fake.pay(second["order_id"], "captured")
    # Even correctly signed for the first order, the payment belongs to the second.
    refused = shop.verify(shop.signed(first["order_id"], other.id))
    assert refused.json()["error"]["code"] == "payment_mismatch"
    assert shop.periods(buyer) == []


def test_razorpay_being_unreachable_during_verify_changes_nothing(
    shop: Shop, buyer: User, fake: FakeProvider
) -> None:
    order = shop.order()
    body = shop.pay(order)

    def down(payment_id: str) -> ProviderPayment:
        raise ProviderUnavailable("down")

    fake.fetch_payment = down  # type: ignore[method-assign]
    refused = shop.verify(body)
    assert refused.status_code == 503
    assert "If you were charged" in refused.json()["error"]["message"]
    assert shop.row(order).status == "created"


# --- periods -------------------------------------------------------------------------------


def test_paying_during_a_period_adds_the_next_one_after_it(shop: Shop, buyer: User) -> None:
    first = shop.verify(shop.pay(shop.order())).json()["period"]
    second = shop.verify(shop.pay(shop.order("studio_pro"))).json()["period"]
    assert second["starts_at"] == first["ends_at"]
    assert second["plan_id"] == "studio_pro"

    me = shop.http.get("/billing/account").json()
    assert (me["plan_id"], me["upcoming"]["plan_id"]) == ("studio", "studio_pro")

    # One period paid in advance is the most.
    refused = shop.checkout()
    assert (refused.status_code, refused.json()["error"]["code"]) == (409, "already_paid_ahead")


def test_an_ended_period_leaves_the_account_on_free(db: Session, shop: Shop, buyer: User) -> None:
    shop.verify(shop.pay(shop.order()))
    period = shop.periods(buyer)[0]
    period.starts_at, period.ends_at = (
        datetime.now(UTC) - 40 * DAY,
        datetime.now(UTC) - 10 * DAY,
    )
    db.flush()
    me = shop.http.get("/billing/account").json()
    assert (me["plan_id"], me["current"], me["upcoming"]) == ("free", None, None)
    new = shop.verify(shop.pay(shop.order())).json()["period"]
    assert roughly_now(new["starts_at"])


def test_the_owner_sees_an_exempt_account(db: Session, shop: Shop) -> None:
    shop.sign_in(account(db), owner=True)
    me = shop.http.get("/billing/account").json()
    assert (me["exempt"], me["plan_id"], me["payments"]) == (True, "free", [])
    assert me["checkout"] == {"available": True, "provider": "fake", "mode": "test"}


# --- the stand-in checkout -----------------------------------------------------------------


def test_the_stand_in_checkout_is_only_served_with_the_fake_provider(
    shop: Shop, buyer: User, shop_settings: Settings
) -> None:
    import app.api.routes.billing as routes

    # The fixture's FakeProvider is a private instance, not the app's stand-in.
    assert shop.http.get("/billing/fake/checkout.js").status_code == 404
    shop.set_provider(routes.FAKE_PROVIDER)  # type: ignore[attr-defined]
    script = shop.http.get("/billing/fake/checkout.js")
    assert script.status_code == 200
    assert script.headers["content-type"].startswith("text/javascript")
    production: Callable[[], Settings] = lambda: shop_settings.model_copy(  # noqa: E731
        update={"app_env": "production"}
    )
    app.dependency_overrides[get_settings] = production
    assert shop.http.get("/billing/fake/checkout.js").status_code == 404
    assert (
        shop.http.post(
            "/billing/fake/pay", json={"order_id": "order_x1", "outcome": "captured"}
        ).status_code
        == 404
    )
