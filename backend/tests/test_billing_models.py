"""M14-2: the rules the database itself keeps for payments and paid access periods.

Each refusal is checked by the name of the constraint that refuses it, so a test can't pass
because some other rule happened to fire.
"""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.billing.plans import PlanId
from app.models import BillingEvent, Payment, Subscription, User
from app.models.enums import PaidPlan

pytestmark = pytest.mark.db

NOW = datetime(2026, 11, 13, 12, 0, tzinfo=UTC)
DAYS_30 = timedelta(days=30)


def account(db: Session, name: str = "Studio") -> User:
    user = User(display_name=name)
    db.add(user)
    db.flush()
    return user


def payment(db: Session, user: User | None, **overrides: Any) -> Payment:
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


def paid(db: Session, user: User | None, **overrides: Any) -> Payment:
    settled = {
        "status": "paid",
        "paid_at": NOW,
        "provider_payment_id": f"pay_{uuid4().hex[:14]}",
        "method": "upi",
    }
    return payment(db, user, **{**settled, **overrides})


def period(db: Session, pay: Payment, starts: datetime = NOW, **overrides: Any) -> Subscription:
    values: dict[str, Any] = {
        "user_id": pay.user_id,
        "payment_id": pay.id,
        "plan_id": pay.plan_id,
        "status": "active",
        "starts_at": starts,
        "ends_at": starts + DAYS_30,
    }
    row = Subscription(**{**values, **overrides})
    db.add(row)
    db.flush()
    return row


def refused(db: Session, constraint: str, make: Callable[[], object]) -> None:
    with pytest.raises(IntegrityError, match=constraint), db.begin_nested():
        make()


def test_paid_plans_match_the_catalogue() -> None:
    assert {p.value for p in PaidPlan} == {p.value for p in PlanId} - {"free"}


def test_a_verified_payment_and_its_period_are_stored(db: Session) -> None:
    user = account(db)
    pay = paid(db, user, plan_id="studio_pro", amount_paise=249_900)
    access = period(db, pay)
    db.refresh(pay)
    assert (pay.currency, pay.refunded_paise, pay.created_at.tzinfo is not None) == ("INR", 0, True)
    assert (access.plan_id, access.ends_at - access.starts_at) == ("studio_pro", DAYS_30)


@pytest.mark.parametrize(
    ("overrides", "constraint"),
    [
        ({"amount_paise": 0}, "ck_payments_positive_amount"),
        ({"amount_paise": -100}, "ck_payments_positive_amount"),
        ({"currency": "USD"}, "ck_payments_currency"),
        ({"plan_id": "free"}, "ck_payments_plan_id"),
        ({"plan_id": "enterprise"}, "ck_payments_plan_id"),
        ({"status": "captured"}, "ck_payments_status"),
        ({"provider": "stripe"}, "ck_payments_provider"),
        ({"method": "crypto"}, "ck_payments_method"),
        ({"period_days": 0}, "ck_payments_period_days"),
        ({"period_days": 400}, "ck_payments_period_days"),
        # A payment can't be marked paid without having been verified.
        ({"status": "paid"}, "ck_payments_paid_at"),
        ({"status": "paid", "paid_at": NOW}, "ck_payments_paid_id"),
        ({"paid_at": NOW}, "ck_payments_paid_at"),
        ({"status": "failed"}, "ck_payments_failed_at"),
        ({"refunded_paise": 100}, "ck_payments_refund_only_when_paid"),
    ],
)
def test_malformed_payments_are_refused(
    db: Session, overrides: dict[str, Any], constraint: str
) -> None:
    user = account(db)
    refused(db, constraint, lambda: payment(db, user, **overrides))


def test_refunds_stay_within_the_amount_and_full_means_refunded(db: Session) -> None:
    user = account(db)
    refund = {"refunded_at": NOW}
    refused(
        db,
        "ck_payments_refund_within_amount",
        lambda: paid(db, user, refunded_paise=99_901, **refund),
    )
    refused(db, "ck_payments_full_refund", lambda: paid(db, user, refunded_paise=99_900, **refund))
    refused(db, "ck_payments_full_refund", lambda: paid(db, user, status="refunded", **refund))
    refused(db, "ck_payments_refunded_at", lambda: paid(db, user, refunded_paise=500))
    partial = paid(db, user, refunded_paise=500, **refund)
    full = paid(db, user, status="refunded", refunded_paise=99_900, **refund)
    failed = payment(db, user, status="failed", failed_at=NOW, failure_code="BAD_REQUEST_ERROR")
    assert [p.status for p in (partial, full, failed)] == ["paid", "refunded", "failed"]


def test_order_and_payment_ids_are_never_recorded_twice(db: Session) -> None:
    user = account(db)
    first = paid(db, user)
    refused(
        db,
        "uq_payments_provider_order_id",
        lambda: payment(db, user, provider_order_id=first.provider_order_id),
    )
    refused(
        db,
        "uq_payments_provider_payment_id",
        lambda: paid(db, user, provider_payment_id=first.provider_payment_id),
    )


def test_access_only_comes_from_this_accounts_own_payment_for_that_plan(db: Session) -> None:
    user, other = account(db), account(db, "Other")
    studio = paid(db, user)
    refused(db, "fk_subscriptions_payment", lambda: period(db, studio, user_id=other.id))
    refused(db, "fk_subscriptions_payment", lambda: period(db, studio, plan_id="studio_pro"))
    refused(db, "fk_subscriptions_payment", lambda: period(db, studio, payment_id=uuid4()))
    period(db, studio)
    # One payment buys one period, never two.
    refused(db, "uq_subscriptions_payment_id", lambda: period(db, studio, starts=NOW + DAYS_30))


def test_one_account_never_holds_two_active_periods_at_once(db: Session) -> None:
    user, other = account(db), account(db, "Other")
    first = period(db, paid(db, user))
    refused(
        db,
        "ex_subscriptions_no_overlap",
        lambda: period(db, paid(db, user), starts=NOW + timedelta(days=29)),
    )
    # Back to back is a renewal; another account's period is unrelated.
    period(db, paid(db, user), starts=first.ends_at)
    period(db, paid(db, other))
    # A period that ended early no longer blocks one in its place.
    first.status, first.cancelled_at, first.cancel_reason = "cancelled", NOW, "refund"
    db.flush()
    period(db, paid(db, user, plan_id="studio_pro", amount_paise=249_900), starts=NOW)


@pytest.mark.parametrize(
    ("overrides", "constraint"),
    [
        ({"ends_at": NOW}, "ck_subscriptions_ends_after_start"),
        ({"ends_at": NOW - DAYS_30}, "ck_subscriptions_ends_after_start"),
        ({"status": "expired"}, "ck_subscriptions_status"),
        ({"status": "cancelled", "cancel_reason": "refund"}, "ck_subscriptions_cancelled"),
        ({"status": "cancelled", "cancelled_at": NOW}, "ck_subscriptions_cancel_has_reason"),
        (
            {"status": "cancelled", "cancelled_at": NOW, "cancel_reason": "bored"},
            "ck_subscriptions_cancel_reason",
        ),
        ({"cancelled_at": NOW}, "ck_subscriptions_cancelled"),
    ],
)
def test_malformed_periods_are_refused(
    db: Session, overrides: dict[str, Any], constraint: str
) -> None:
    pay = paid(db, account(db))
    refused(db, constraint, lambda: period(db, pay, **overrides))


def test_a_payment_that_grants_a_period_cannot_be_deleted(db: Session) -> None:
    pay = paid(db, account(db))
    period(db, pay)

    def delete() -> None:
        db.execute(text("DELETE FROM payments WHERE id = :id"), {"id": pay.id})

    refused(db, "fk_subscriptions_payment", delete)


def test_deleting_an_account_keeps_its_payments_and_ends_its_access(db: Session) -> None:
    user, other = account(db), account(db, "Other")
    pay = paid(db, user)
    period(db, pay)
    theirs = period(db, paid(db, other))
    db.execute(text("DELETE FROM users WHERE id = :id"), {"id": user.id})
    db.expire_all()

    kept = db.get_one(Payment, pay.id)
    assert (kept.user_id, kept.amount_paise, kept.provider_order_id) == (
        None,
        99_900,
        pay.provider_order_id,
    )
    remaining = db.scalars(select(Subscription.id)).all()
    assert remaining == [theirs.id]


def test_each_webhook_event_is_recorded_once_and_outlives_its_payment(db: Session) -> None:
    pay = paid(db, None)
    event = {
        "provider": "razorpay",
        "event_id": "evt_1",
        "event_type": "payment.captured",
        "occurred_at": NOW,
        "payment_id": pay.id,
        "outcome": "applied",
    }

    def record(**overrides: Any) -> BillingEvent:
        row = BillingEvent(**{**event, **overrides})
        db.add(row)
        db.flush()
        return row

    first = record()
    assert first.received_at is not None
    refused(db, "uq_billing_events_provider_event_id", lambda: record(outcome="ignored"))
    refused(db, "ck_billing_events_outcome", lambda: record(event_id="evt_2", outcome="done"))
    refused(db, "ck_billing_events_provider", lambda: record(event_id="evt_3", provider="paypal"))

    db.execute(text("DELETE FROM payments WHERE id = :id"), {"id": pay.id})
    db.expire_all()
    assert db.get_one(BillingEvent, first.id).payment_id is None
