"""Plans, an account's plan, and checkout (/billing).

The catalogue is public. Checkout runs in Razorpay TEST MODE only (see app/services/billing.py
for how a payment is verified). The /billing/fake/* endpoints serve a local stand-in for
Razorpay Checkout to development and end-to-end tests; they answer 404 everywhere else.
"""

import json
import re
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.billing.plans import CURRENCY, FEATURES, plans
from app.billing.razorpay import (
    FAKE_PROVIDER,
    FakeProvider,
    PaymentProvider,
    ProviderError,
    parse_event,
    provider_for,
    webhook_secret_for,
    webhook_signature_matches,
)
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.schemas.billing import (
    BillingAccount,
    CheckoutCreate,
    CheckoutOrder,
    CheckoutResult,
    CheckoutVerify,
    FakePay,
    FeatureRead,
    PlanCatalogue,
    PlanRead,
)
from app.services.billing import BillingRefused, BillingService, BillingUnavailable
from app.services.billing_webhooks import WebhookService

FAKE_CHECKOUT_JS = Path(__file__).resolve().parents[2] / "billing" / "fake_checkout.js"
NO_STORE = "no-store"
# Razorpay's events are a few kilobytes; anything far larger isn't one.
MAX_WEBHOOK_BYTES = 64 * 1024
EVENT_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")

router = APIRouter(prefix="/billing", tags=["billing"])


@router.get("/plans", response_model=PlanCatalogue)
def list_plans(
    response: Response, settings: Annotated[Settings, Depends(get_settings)]
) -> PlanCatalogue:
    """The plans, cheapest first, with server-defined prices in paise. No sign-in needed."""
    response.headers["Cache-Control"] = "public, max-age=300"
    return PlanCatalogue(
        status="proposed",
        on_sale=False,
        features=[FeatureRead(key=f.key, label=f.label, detail=f.detail) for f in FEATURES],
        plans=[
            PlanRead(
                id=p.id,
                name=p.name,
                summary=p.summary,
                price_paise=p.price_paise,
                currency=CURRENCY,
                period_days=p.period_days,
                max_pieces=p.max_pieces,
                max_bytes=p.max_bytes,
                features=list(p.features),
            )
            for p in plans(settings)
        ],
    )


def get_payment_provider(
    settings: Annotated[Settings, Depends(get_settings)],
) -> PaymentProvider | None:
    return provider_for(settings)


def get_billing_service(
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
    provider: Annotated[PaymentProvider | None, Depends(get_payment_provider)],
) -> BillingService:
    return BillingService(db, settings, provider)


Billing = Annotated[BillingService, Depends(get_billing_service)]


@router.get("/account", response_model=BillingAccount)
def billing_account(user: CurrentUser, billing: Billing, response: Response) -> BillingAccount:
    """The signed-in account's plan, paid periods and recent payments."""
    response.headers["Cache-Control"] = NO_STORE
    return billing.account(user)


@router.post("/checkout", response_model=CheckoutOrder, status_code=status.HTTP_201_CREATED)
def start_checkout(
    body: CheckoutCreate, user: CurrentUser, billing: Billing, response: Response
) -> CheckoutOrder:
    """Create a Razorpay order for one period of a paid plan, at the catalogue's price."""
    response.headers["Cache-Control"] = NO_STORE
    return billing.checkout(user, body.plan_id)


@router.post("/checkout/verify", response_model=CheckoutResult)
def verify_checkout(
    body: CheckoutVerify, user: CurrentUser, billing: Billing, response: Response
) -> CheckoutResult:
    """Confirm a payment Checkout reported, with Razorpay itself, before granting access."""
    response.headers["Cache-Control"] = NO_STORE
    return billing.verify(user, body.order_id, body.payment_id, body.signature)


@router.post("/webhooks/razorpay", include_in_schema=False)
async def razorpay_webhook(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    provider: Annotated[PaymentProvider | None, Depends(get_payment_provider)],
    billing: Billing,
) -> dict[str, str]:
    """Events from Razorpay, signed with the webhook secret. No session: the signature over the
    raw body is the only thing that makes a request believable. Answers 2xx once an event is
    recorded (or recognised as a repeat), so Razorpay stops retrying it."""
    secret = webhook_secret_for(settings, provider)
    if secret is None:
        # 503 rather than 404: Razorpay keeps retrying for 24 hours while this is fixed.
        raise BillingUnavailable("webhooks_not_configured", "Webhooks aren't set up here.")
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_WEBHOOK_BYTES:
        raise BillingRefused("too_large", "That is not a webhook event.", 413)
    body = await request.body()
    if len(body) > MAX_WEBHOOK_BYTES:
        raise BillingRefused("too_large", "That is not a webhook event.", 413)
    # Checked on the exact bytes received, before anything in them is read.
    signature = request.headers.get("x-razorpay-signature", "")
    if not webhook_signature_matches(secret, body, signature):
        raise BillingRefused("signature_invalid", "The webhook signature did not match.", 400)
    event_id = request.headers.get("x-razorpay-event-id", "")
    if not EVENT_ID.fullmatch(event_id):
        raise BillingRefused("event_id_missing", "The webhook had no usable event id.", 400)
    try:
        event = parse_event(json.loads(body))
    except (ValueError, ProviderError) as exc:
        raise BillingRefused("not_an_event", "The webhook body is not an event.", 400) from exc
    handled = await run_in_threadpool(WebhookService(billing.db, billing).handle, event_id, event)
    return {"status": handled.outcome}


# --- the local stand-in for Razorpay Checkout (development and end-to-end tests only) ------


def fake_provider(
    provider: Annotated[PaymentProvider | None, Depends(get_payment_provider)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> FakeProvider:
    if settings.app_env == "production" or provider is not FAKE_PROVIDER:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    return FAKE_PROVIDER


Fake = Annotated[FakeProvider, Depends(fake_provider)]


@router.get("/fake/checkout.js", include_in_schema=False)
def fake_checkout_script(_: Fake) -> Response:
    return Response(
        FAKE_CHECKOUT_JS.read_text(encoding="utf-8"),
        media_type="text/javascript",
        headers={"Cache-Control": NO_STORE},
    )


@router.post("/fake/pay", include_in_schema=False)
def fake_pay(body: FakePay, _: CurrentUser, fake: Fake) -> dict[str, object]:
    """What a button in the stand-in checkout does: settle a fake order one way or another."""
    try:
        payment = fake.pay(body.order_id, body.outcome)
    except ProviderError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found") from exc
    if body.outcome == "failed":
        return {"error": {"code": payment.error_code, "reason": "payment_failed"}}
    return {
        "razorpay_payment_id": payment.id,
        "razorpay_order_id": payment.order_id,
        "razorpay_signature": fake.sign(payment.order_id, payment.id),
    }
