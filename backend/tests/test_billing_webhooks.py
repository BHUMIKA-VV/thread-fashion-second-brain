"""M14-4: Razorpay webhooks and reconciliation.

Webhook bodies follow the sample payloads in Razorpay's webhook docs (payment.captured,
payment.failed, order.paid, refund.processed): the payment entity at payload.payment.entity,
amounts in paise, created_at in Unix seconds. Each is signed here with a test webhook secret.
"""

import json
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from itertools import count
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.routes.billing import MAX_WEBHOOK_BYTES, get_payment_provider
from app.billing.razorpay import FakeProvider, webhook_signature
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.main import app
from app.models import BillingEvent, Payment, Subscription, User
from app.services.billing import BillingService, BillingUnavailable

pytestmark = pytest.mark.db

WEBHOOK_SECRET = "test-webhook-secret"  # noqa: S105 (a made-up test value)
CREATED_AT = 1_767_000_000
ids = count(1)


@pytest.fixture
def hook_settings() -> Settings:
    return get_settings().model_copy(
        update={
            "payment_provider": "razorpay",
            "razorpay_webhook_secret": SecretStr(WEBHOOK_SECRET),
        }
    )


@pytest.fixture
def hooks(db: Session, hook_settings: Settings) -> Iterator[TestClient]:
    app.dependency_overrides.update(
        {
            get_db: lambda: db,
            get_settings: lambda: hook_settings,
            get_payment_provider: lambda: None,  # webhooks need no API keys
        }
    )
    # No session cookie and no Origin header, as Razorpay sends them.
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client
    app.dependency_overrides.clear()


def unpaid(db: Session, user: User | None, **overrides: Any) -> Payment:
    values: dict[str, Any] = {
        "user_id": user.id if user else None,
        "provider": "razorpay",
        "provider_order_id": f"order_{uuid4().hex[:14]}",
        "plan_id": "studio",
        "amount_paise": 99_900,
        "currency": "INR",
        "period_days": 30,
        "status": "created",
    }
    row = Payment(**{**values, **overrides})
    db.add(row)
    db.flush()
    return row


def account(db: Session) -> User:
    user = User(display_name="Buyer")
    db.add(user)
    db.flush()
    return user


def entity(pay: Payment, status: str = "captured", **overrides: Any) -> dict[str, Any]:
    """A payment entity as Razorpay sends it, personal fields included."""
    return {
        "id": overrides.pop("id", f"pay_{pay.provider_order_id[6:]}"),
        "entity": "payment",
        "amount": pay.amount_paise,
        "currency": "INR",
        "status": status,
        "order_id": pay.provider_order_id,
        "method": "upi",
        "amount_refunded": 0,
        "refund_status": None,
        "captured": status == "captured",
        "email": "buyer@example.com",
        "contact": "+919000090000",
        "vpa": "buyer@okbank",
        "error_code": "BAD_REQUEST_ERROR" if status == "failed" else None,
        "created_at": CREATED_AT - 10,
        **overrides,
    }


def event(kind: str, payment: dict[str, Any], **extra: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {"payment": {"entity": payment}}
    contains = ["payment"]
    if kind.startswith("refund."):
        contains = ["refund", "payment"]
        payload["refund"] = {
            "entity": {
                "id": f"rfnd_{next(ids)}",
                "entity": "refund",
                "amount": extra.pop("refund", payment["amount_refunded"]),
                "currency": "INR",
                "payment_id": payment["id"],
                "status": "processed",
            }
        }
    return {
        "entity": "event",
        "account_id": "acc_test",
        "event": kind,
        "contains": contains,
        "payload": payload,
        "created_at": CREATED_AT,
        **extra,
    }


def deliver(
    client: TestClient,
    body: dict[str, Any] | bytes,
    event_id: str | None = None,
    *,
    secret: str = WEBHOOK_SECRET,
    headers: dict[str, str] | None = None,
) -> Any:
    raw = body if isinstance(body, bytes) else json.dumps(body).encode()
    sent = {
        "content-type": "application/json",
        "x-razorpay-signature": webhook_signature(secret, raw),
        "x-razorpay-event-id": event_id or f"evt_{next(ids)}",
        **(headers or {}),
    }
    return client.post("/billing/webhooks/razorpay", content=raw, headers=sent)


def periods(db: Session, pay: Payment) -> list[Subscription]:
    db.expire_all()
    return list(db.scalars(select(Subscription).where(Subscription.payment_id == pay.id)))


def fresh(db: Session, pay: Payment) -> Payment:
    db.expire_all()
    return db.get_one(Payment, pay.id)


# --- settling ------------------------------------------------------------------------------


def test_a_captured_payment_is_settled_once_however_often_it_is_delivered(
    db: Session, hooks: TestClient
) -> None:
    pay = unpaid(db, account(db))
    body = event("payment.captured", entity(pay))
    first = deliver(hooks, body, "evt_A1")
    assert (first.status_code, first.json()) == (200, {"status": "applied"})
    row = fresh(db, pay)
    assert (row.status, row.method, row.provider_payment_id) == (
        "paid",
        "upi",
        body["payload"]["payment"]["entity"]["id"],
    )
    [period] = periods(db, pay)
    assert period.ends_at - period.starts_at == timedelta(days=30)

    # Razorpay delivers at least once: the same event again, then order.paid for the order.
    assert deliver(hooks, body, "evt_A1").json() == {"status": "duplicate"}
    assert deliver(hooks, event("order.paid", entity(pay))).json() == {"status": "ignored"}
    assert len(periods(db, pay)) == 1
    recorded = db.scalars(select(BillingEvent).order_by(BillingEvent.received_at)).all()
    assert [(e.event_type, e.outcome) for e in recorded] == [
        ("payment.captured", "applied"),
        ("order.paid", "ignored"),
    ]
    assert recorded[0].occurred_at == datetime.fromtimestamp(CREATED_AT, UTC)


def test_order_paid_alone_settles_the_payment(db: Session, hooks: TestClient) -> None:
    pay = unpaid(db, account(db))
    assert deliver(hooks, event("order.paid", entity(pay))).json() == {"status": "applied"}
    assert fresh(db, pay).status == "paid"


def test_a_failure_then_a_success_on_the_same_order_ends_paid(
    db: Session, hooks: TestClient
) -> None:
    pay = unpaid(db, account(db))
    failed = deliver(hooks, event("payment.failed", entity(pay, "failed", id="pay_firsttry1")))
    assert failed.json() == {"status": "applied"}
    row = fresh(db, pay)
    assert (row.status, row.failure_code) == ("failed", "BAD_REQUEST_ERROR")
    assert deliver(hooks, event("payment.captured", entity(pay))).json() == {"status": "applied"}
    row = fresh(db, pay)
    assert (row.status, row.failed_at, row.failure_code) == ("paid", None, None)


def test_a_failure_reported_after_the_capture_changes_nothing(
    db: Session, hooks: TestClient
) -> None:
    pay = unpaid(db, account(db))
    deliver(hooks, event("payment.captured", entity(pay)))
    late = deliver(hooks, event("payment.failed", entity(pay, "failed", id="pay_otherattempt")))
    assert late.json() == {"status": "stale"}
    assert fresh(db, pay).status == "paid"
    assert len(periods(db, pay)) == 1


def test_an_authorisation_alone_grants_nothing(db: Session, hooks: TestClient) -> None:
    pay = unpaid(db, account(db))
    body = event("payment.authorized", entity(pay, "authorized"))
    assert deliver(hooks, body).json() == {"status": "ignored"}
    assert (fresh(db, pay).status, periods(db, pay)) == ("created", [])


@pytest.mark.parametrize("change", [{"amount": 100}, {"currency": "USD"}, {"status": "authorized"}])
def test_a_capture_that_does_not_match_the_order_is_ignored(
    db: Session, hooks: TestClient, change: dict[str, Any]
) -> None:
    pay = unpaid(db, account(db))
    assert deliver(hooks, event("payment.captured", entity(pay, **change))).json() == {
        "status": "ignored"
    }
    assert (fresh(db, pay).status, periods(db, pay)) == ("created", [])


def test_events_for_orders_that_are_not_threads_are_recorded_and_ignored(
    db: Session, hooks: TestClient
) -> None:
    stranger = {
        "id": "pay_notours12345",
        "amount": 500,
        "currency": "INR",
        "status": "captured",
        "order_id": "order_notours12345",
    }
    assert deliver(hooks, event("payment.captured", stranger)).json() == {"status": "ignored"}
    assert deliver(hooks, {"entity": "event", "event": "payment.downtime.started"}).json() == {
        "status": "ignored"
    }
    assert db.scalar(select(func.count()).select_from(BillingEvent)) == 2
    assert db.scalar(select(func.count()).select_from(Subscription)) == 0


def test_a_capture_after_the_account_was_deleted_is_recorded_without_access(
    db: Session, hooks: TestClient
) -> None:
    pay = unpaid(db, None)
    assert deliver(hooks, event("payment.captured", entity(pay))).json() == {"status": "applied"}
    assert (fresh(db, pay).status, periods(db, pay)) == ("paid", [])


# --- refunds -------------------------------------------------------------------------------


def test_a_partial_refund_keeps_access_and_a_full_one_ends_it(
    db: Session, hooks: TestClient
) -> None:
    pay = unpaid(db, account(db))
    deliver(hooks, event("payment.captured", entity(pay)))
    partial = entity(pay, amount_refunded=30_000, refund_status="partial")
    assert deliver(hooks, event("refund.processed", partial)).json() == {"status": "applied"}
    row = fresh(db, pay)
    assert (row.status, row.refunded_paise, row.refunded_at is not None) == ("paid", 30_000, True)
    assert [p.status for p in periods(db, pay)] == ["active"]

    full = entity(pay, "refunded", amount_refunded=99_900, refund_status="full")
    assert deliver(hooks, event("refund.processed", full)).json() == {"status": "applied"}
    row = fresh(db, pay)
    assert (row.status, row.refunded_paise) == ("refunded", 99_900)
    [period] = periods(db, pay)
    assert (period.status, period.cancel_reason) == ("cancelled", "refund")

    # The partial refund's report arriving again, or late, moves nothing back.
    assert deliver(hooks, event("refund.processed", partial)).json() == {"status": "stale"}
    assert fresh(db, pay).refunded_paise == 99_900


def test_a_refund_of_a_payment_thread_never_settled_is_ignored(
    db: Session, hooks: TestClient
) -> None:
    # Razorpay refunds an authorisation that is never captured.
    pay = unpaid(db, account(db))
    auto = entity(pay, "refunded", captured=False, amount_refunded=99_900)
    assert deliver(hooks, event("refund.processed", auto)).json() == {"status": "ignored"}
    assert fresh(db, pay).status == "created"


def test_refund_created_and_failed_move_no_money(db: Session, hooks: TestClient) -> None:
    pay = unpaid(db, account(db))
    deliver(hooks, event("payment.captured", entity(pay)))
    for kind in ("refund.created", "refund.failed"):
        body = event(kind, entity(pay, amount_refunded=50_000), refund=50_000)
        assert deliver(hooks, body).json() == {"status": "ignored"}
    assert fresh(db, pay).refunded_paise == 0


# --- what is refused -----------------------------------------------------------------------


def test_unsigned_forged_or_altered_bodies_are_refused_and_not_recorded(
    db: Session, hooks: TestClient
) -> None:
    pay = unpaid(db, account(db))
    body = event("payment.captured", entity(pay))
    raw = json.dumps(body).encode()
    forged = deliver(hooks, body, secret="someone-elses-secret")  # noqa: S106
    assert (forged.status_code, forged.json()["error"]["code"]) == (400, "signature_invalid")
    # Signed, then re-encoded: the same JSON in other bytes no longer matches.
    altered = json.dumps(body, indent=2).encode()
    signature = {"x-razorpay-signature": webhook_signature(WEBHOOK_SECRET, raw)}
    assert deliver(hooks, altered, headers=signature).status_code == 400
    assert deliver(hooks, body, headers={"x-razorpay-signature": ""}).status_code == 400
    assert db.scalar(select(func.count()).select_from(BillingEvent)) == 0
    assert fresh(db, pay).status == "created"


@pytest.mark.parametrize("event_id", ["", "evt with spaces", "x" * 65])
def test_an_event_without_a_usable_id_is_refused(hooks: TestClient, event_id: str) -> None:
    body = {"entity": "event", "event": "payment.captured"}
    refused = deliver(hooks, body, headers={"x-razorpay-event-id": event_id})
    assert (refused.status_code, refused.json()["error"]["code"]) == (400, "event_id_missing")


def test_oversized_and_non_event_bodies_are_refused(hooks: TestClient) -> None:
    assert deliver(hooks, b"x" * (MAX_WEBHOOK_BYTES + 1)).status_code == 413
    for raw in (b"not json", b"[1, 2]", b'{"entity": "event"}'):
        refused = deliver(hooks, raw)
        assert (refused.status_code, refused.json()["error"]["code"]) == (400, "not_an_event")


def test_without_a_webhook_secret_razorpay_is_told_to_retry_later(
    hooks: TestClient, hook_settings: Settings
) -> None:
    app.dependency_overrides[get_settings] = lambda: hook_settings.model_copy(
        update={"razorpay_webhook_secret": None}
    )
    refused = deliver(hooks, {"entity": "event", "event": "payment.captured"})
    assert (refused.status_code, refused.json()["error"]["code"]) == (
        503,
        "webhooks_not_configured",
    )


def test_a_cross_site_browser_request_is_still_refused(hooks: TestClient) -> None:
    body = {"entity": "event", "event": "payment.captured"}
    refused = deliver(hooks, body, headers={"origin": "https://evil.example"})
    assert refused.status_code == 403


# --- reconciliation ------------------------------------------------------------------------


def reconciler(db: Session, fake: FakeProvider | None, hours: float = 1) -> BillingService:
    # An hour from now, so payments made in this test are old enough to be checked.
    now = datetime.now(UTC) + timedelta(hours=hours)
    return BillingService(db, get_settings(), fake, clock=lambda: now)


def faked_order(db: Session, fake: FakeProvider, user: User | None) -> Payment:
    order = fake.create_order(99_900, "INR", "thr_test", {})
    return unpaid(db, user, provider_order_id=order.id)


def run(service: BillingService, *, apply: bool = True) -> dict[Any, str]:
    report = service.reconcile(
        settle_after=timedelta(minutes=15), look_back=timedelta(days=7), apply=apply
    )
    return {row.payment_id: row.after for row in report}


def test_reconciling_settles_captures_and_all_failed_orders(db: Session) -> None:
    fake, user = FakeProvider(), account(db)
    captured, failed, open_, none = (faked_order(db, fake, user) for _ in range(4))
    fake.pay(captured.provider_order_id, "failed")
    fake.pay(captured.provider_order_id, "captured")
    fake.pay(failed.provider_order_id, "failed")
    fake.pay(open_.provider_order_id, "authorized")

    # Report only: nothing is written.
    preview = run(reconciler(db, fake), apply=False)
    assert preview[captured.id] == "would be captured"
    assert fresh(db, captured).status == "created"

    result = run(reconciler(db, fake))
    assert result == {
        captured.id: "paid",
        failed.id: "failed",
        open_.id: "unchanged",
        none.id: "unchanged",
    }
    assert len(periods(db, captured)) == 1
    assert fresh(db, failed).failure_code == "BAD_REQUEST_ERROR"
    # A second run finds the failure already recorded and leaves it.
    assert run(reconciler(db, fake))[failed.id] == "unchanged"
    assert captured.id not in run(reconciler(db, fake))


def test_reconciling_skips_recent_payments_and_needs_keys(db: Session) -> None:
    fake = FakeProvider()
    recent = faked_order(db, fake, account(db))
    fake.pay(recent.provider_order_id, "captured")
    assert run(reconciler(db, fake, hours=0)) == {}
    with pytest.raises(BillingUnavailable):
        run(reconciler(db, None))
