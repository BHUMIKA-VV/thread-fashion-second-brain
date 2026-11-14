"""Talking to Razorpay (test mode only), and a local stand-in for tests.

Only two API calls are made, with HTTP Basic auth (key id and secret), straight through
httpx rather than an SDK:

- POST /v1/orders: an order for an amount the server took from the plan catalogue;
- GET /v1/payments/{id}: what Razorpay says happened to a payment.

A payment is trusted only after both: the checkout's signature (HMAC-SHA256 of
"<our order id>|<payment id>" with the key secret) proves the ids came from Razorpay, and the
fetched payment is captured, on our order, for our amount and currency. What the browser says
about success is never enough on its own.

Only what billing needs is read from a response: ids, amount, currency, status, the kind of
method and a short error code. The payer's email, phone, card, UPI ID or bank are never read.
"""

import dataclasses
import hashlib
import hmac
import logging
import re
import secrets
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, Protocol

import httpx

from app.core.config import Settings
from app.models.enums import PaymentMethod

logger = logging.getLogger(__name__)

API_BASE = "https://api.razorpay.com/v1"
ORDER_ID = re.compile(r"order_[A-Za-z0-9]{1,40}")
PAYMENT_ID = re.compile(r"pay_[A-Za-z0-9]{1,40}")
SIGNATURE = re.compile(r"[0-9a-f]{64}")
ERROR_CODE = re.compile(r"[A-Z][A-Z_]{0,63}")

ProviderStatus = Literal["created", "authorized", "captured", "refunded", "failed"]
PROVIDER_STATUSES: frozenset[str] = frozenset(
    ("created", "authorized", "captured", "refunded", "failed")
)
METHODS = {m.value for m in PaymentMethod} - {PaymentMethod.OTHER.value}


class ProviderUnavailable(Exception):
    """Razorpay couldn't be reached, timed out, failed, or refused the keys (maps to 503)."""


class ProviderError(Exception):
    """Razorpay answered with something Thread can't use (maps to 502)."""


@dataclass(frozen=True)
class Order:
    id: str
    amount_paise: int
    currency: str


@dataclass(frozen=True)
class ProviderPayment:
    id: str
    order_id: str
    amount_paise: int
    currency: str
    status: ProviderStatus
    method: str | None
    error_code: str | None
    # Refunded so far, in paise (cumulative): only webhook and fetch payloads carry it.
    refunded_paise: int = 0


RefundStatus = Literal["pending", "processed", "failed"]
REFUND_ID = re.compile(r"rfnd_[A-Za-z0-9]{1,40}")


@dataclass(frozen=True)
class Refund:
    id: str
    payment_id: str
    amount_paise: int
    status: RefundStatus
    receipt: str | None


@dataclass(frozen=True)
class WebhookEvent:
    """The parts of a webhook event Thread acts on. The body itself is never stored."""

    type: str
    occurred_at: datetime
    # None when the event carries no payment Thread can read (most event types).
    payment: ProviderPayment | None


class PaymentProvider(Protocol):
    name: Literal["razorpay", "fake"]
    key_id: str

    def create_order(
        self, amount_paise: int, currency: str, receipt: str, notes: dict[str, str]
    ) -> Order: ...

    def fetch_payment(self, payment_id: str) -> ProviderPayment: ...

    def signature_valid(self, order_id: str, payment_id: str, signature: str) -> bool: ...

    def order_payments(self, order_id: str) -> list[ProviderPayment]: ...

    def refund(self, payment_id: str, amount_paise: int, receipt: str) -> Refund: ...

    def payment_refunds(self, payment_id: str) -> list[Refund]: ...


def payment_signature(secret: str, order_id: str, payment_id: str) -> str:
    """The signature Razorpay Checkout returns for a successful payment."""
    message = f"{order_id}|{payment_id}".encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def signature_matches(secret: str, order_id: str, payment_id: str, signature: str) -> bool:
    """Constant-time comparison; malformed input is simply not a match."""
    if not (SIGNATURE.fullmatch(signature) and PAYMENT_ID.fullmatch(payment_id)):
        return False
    expected = payment_signature(secret, order_id, payment_id)
    return hmac.compare_digest(expected, signature)


def webhook_signature(secret: str, body: bytes) -> str:
    """X-Razorpay-Signature: HMAC-SHA256 of the raw request body with the webhook secret."""
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def webhook_signature_matches(secret: str, body: bytes, signature: str) -> bool:
    if not SIGNATURE.fullmatch(signature):
        return False
    return hmac.compare_digest(webhook_signature(secret, body), signature)


def parse_event(body: Any) -> WebhookEvent:
    """Read a verified webhook body. Only the payment entity is read, and only if well formed;
    an event Thread can't read is still a valid event, just one it ignores."""
    if not isinstance(body, dict) or not isinstance(body.get("event"), str):
        raise ProviderError("Not a Razorpay webhook event")
    created = body.get("created_at")
    # Unix seconds in Razorpay's samples; a missing or odd value falls back to now.
    occurred_at = (
        datetime.fromtimestamp(created, UTC)
        if type(created) is int and 0 < created < 10**11
        else datetime.now(UTC)
    )
    payment = None
    entity = (
        body.get("payload", {}).get("payment", {}) if isinstance(body.get("payload"), dict) else {}
    )
    if isinstance(entity, dict) and isinstance(entity.get("entity"), dict):
        try:
            payment = parse_payment(entity["entity"])
        except ProviderError:
            payment = None
    return WebhookEvent(type=body["event"][:64], occurred_at=occurred_at, payment=payment)


def method_kind(method: object) -> str | None:
    """Only the kind of method; EMI, pay-later and anything new become "other"."""
    if not isinstance(method, str) or not method:
        return None
    return method if method in METHODS else PaymentMethod.OTHER.value


def _error_code(value: object) -> str | None:
    if value is None:
        return None
    return value if isinstance(value, str) and ERROR_CODE.fullmatch(value) else "UNKNOWN_ERROR"


def parse_order(body: Any) -> Order:
    try:
        order = Order(id=body["id"], amount_paise=body["amount"], currency=body["currency"])
    except (KeyError, TypeError) as exc:
        raise ProviderError("Razorpay's order response was incomplete") from exc
    if not (
        isinstance(order.id, str)
        and ORDER_ID.fullmatch(order.id)
        and type(order.amount_paise) is int
        and isinstance(order.currency, str)
    ):
        raise ProviderError("Razorpay's order response was malformed")
    return order


def parse_payment(body: Any) -> ProviderPayment:
    try:
        payment = ProviderPayment(
            id=body["id"],
            order_id=body["order_id"],
            amount_paise=body["amount"],
            currency=body["currency"],
            status=body["status"],
            method=method_kind(body.get("method")),
            error_code=_error_code(body.get("error_code")),
            refunded_paise=body.get("amount_refunded") or 0,
        )
    except (KeyError, TypeError, AttributeError) as exc:
        raise ProviderError("Razorpay's payment response was incomplete") from exc
    if not (
        isinstance(payment.id, str)
        and PAYMENT_ID.fullmatch(payment.id)
        and isinstance(payment.order_id, str)
        and ORDER_ID.fullmatch(payment.order_id)
        and type(payment.amount_paise) is int
        and isinstance(payment.currency, str)
        and payment.status in PROVIDER_STATUSES
        and type(payment.refunded_paise) is int
        and 0 <= payment.refunded_paise <= payment.amount_paise
    ):
        raise ProviderError("Razorpay's payment response was malformed")
    return payment


def parse_refund(body: Any) -> Refund:
    try:
        refund = Refund(
            id=body["id"],
            payment_id=body["payment_id"],
            amount_paise=body["amount"],
            status=body["status"],
            receipt=body.get("receipt"),
        )
    except (KeyError, TypeError, AttributeError) as exc:
        raise ProviderError("Razorpay's refund response was incomplete") from exc
    if not (
        isinstance(refund.id, str)
        and REFUND_ID.fullmatch(refund.id)
        and isinstance(refund.payment_id, str)
        and PAYMENT_ID.fullmatch(refund.payment_id)
        and type(refund.amount_paise) is int
        and refund.status in ("pending", "processed", "failed")
        and (refund.receipt is None or isinstance(refund.receipt, str))
    ):
        raise ProviderError("Razorpay's refund response was malformed")
    return refund


class RazorpayClient:
    """The real Razorpay API, with test keys (settings refuse live ones)."""

    name: Literal["razorpay", "fake"] = "razorpay"

    def __init__(self, settings: Settings, transport: httpx.BaseTransport | None = None) -> None:
        if settings.razorpay_key_id is None or settings.razorpay_key_secret is None:
            raise ProviderUnavailable("Razorpay keys are not set")
        self.key_id = settings.razorpay_key_id
        self._secret = settings.razorpay_key_secret
        self._timeout = settings.razorpay_timeout_seconds
        self._transport = transport

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            # trust_env=False: machine-wide proxy variables never route payment traffic.
            with httpx.Client(
                base_url=API_BASE,
                auth=(self.key_id, self._secret.get_secret_value()),
                timeout=self._timeout,
                transport=self._transport,
                trust_env=False,
            ) as client:
                response = client.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            logger.warning("Razorpay %s %s failed: %s", method, path, type(exc).__name__)
            raise ProviderUnavailable("Razorpay could not be reached") from exc
        if response.status_code in (401, 403):
            logger.error("Razorpay refused the API keys (HTTP %s)", response.status_code)
            raise ProviderUnavailable("Razorpay refused the API keys")
        # 409: an identical idempotent request is still in progress, so retrying later is right.
        if response.status_code >= 500 or response.status_code in (409, 429):
            logger.warning("Razorpay %s %s answered HTTP %s", method, path, response.status_code)
            raise ProviderUnavailable("Razorpay is not available right now")
        if response.status_code >= 400:
            # The error's code only: its description may repeat what was sent.
            logger.warning(
                "Razorpay %s %s refused (HTTP %s, %s)",
                method,
                path,
                response.status_code,
                _error_code(_safe_json(response).get("error", {}).get("code")),
            )
            raise ProviderError(f"Razorpay refused the request (HTTP {response.status_code})")
        body = _safe_json(response)
        if not body:
            raise ProviderError("Razorpay's response was not JSON")
        return body

    def create_order(
        self, amount_paise: int, currency: str, receipt: str, notes: dict[str, str]
    ) -> Order:
        body = self._request(
            "POST",
            "/orders",
            json={"amount": amount_paise, "currency": currency, "receipt": receipt, "notes": notes},
        )
        return parse_order(body)

    def fetch_payment(self, payment_id: str) -> ProviderPayment:
        if not PAYMENT_ID.fullmatch(payment_id):
            raise ProviderError("Not a Razorpay payment id")
        return parse_payment(self._request("GET", f"/payments/{payment_id}"))

    def signature_valid(self, order_id: str, payment_id: str, signature: str) -> bool:
        return signature_matches(self._secret.get_secret_value(), order_id, payment_id, signature)

    def refund(self, payment_id: str, amount_paise: int, receipt: str) -> Refund:
        """Refund (part of) a captured payment: POST /v1/payments/{id}/refund. The receipt is
        Thread's own and unique per refund, and doubles as the idempotency key, so a retried
        request can't refund twice."""
        if not PAYMENT_ID.fullmatch(payment_id):
            raise ProviderError("Not a Razorpay payment id")
        body = self._request(
            "POST",
            f"/payments/{payment_id}/refund",
            json={"amount": amount_paise, "speed": "normal", "receipt": receipt},
            headers={"X-Refund-Idempotency": receipt},
        )
        return parse_refund(body)

    def payment_refunds(self, payment_id: str) -> list[Refund]:
        """Refunds already made on a payment: GET /v1/payments/{id}/refunds."""
        if not PAYMENT_ID.fullmatch(payment_id):
            raise ProviderError("Not a Razorpay payment id")
        body = self._request("GET", f"/payments/{payment_id}/refunds", params={"count": 100})
        items = body.get("items")
        if not isinstance(items, list):
            raise ProviderError("Razorpay's refunds response was malformed")
        return [parse_refund(item) for item in items]

    def order_payments(self, order_id: str) -> list[ProviderPayment]:
        """Every payment attempt on one order (GET /v1/orders/{id}/payments)."""
        if not ORDER_ID.fullmatch(order_id):
            raise ProviderError("Not a Razorpay order id")
        body = self._request("GET", f"/orders/{order_id}/payments")
        items = body.get("items")
        if not isinstance(items, list):
            raise ProviderError("Razorpay's order payments response was malformed")
        return [parse_payment(item) for item in items]


def _safe_json(response: httpx.Response) -> dict[str, Any]:
    try:
        body = response.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


FakeOutcome = Literal["captured", "authorized", "failed"]


class FakeProvider:
    """A stand-in for Razorpay in development and end-to-end tests: orders and payments live
    in memory, nothing leaves the machine and no money moves. Its secret is a fixed, public
    test value, so it can only ever sign its own fake payments."""

    name: Literal["razorpay", "fake"] = "fake"
    key_id = "rzp_test_fakelocal"
    SECRET = "thread-fake-provider-not-a-secret"  # noqa: S105
    # Signs the stand-in's webhooks, which end-to-end tests send themselves.
    WEBHOOK_SECRET = "thread-fake-webhook-not-a-secret"  # noqa: S105

    def __init__(self) -> None:
        self._orders: dict[str, Order] = {}
        self._payments: dict[str, ProviderPayment] = {}
        self._refunds: dict[str, list[Refund]] = {}
        # What the stand-in's next refund comes back as (tests set "pending").
        self.refund_outcome: RefundStatus = "processed"
        self._lock = threading.Lock()

    def create_order(
        self, amount_paise: int, currency: str, receipt: str, notes: dict[str, str]
    ) -> Order:
        order = Order(f"order_{secrets.token_hex(7)}", amount_paise, currency)
        with self._lock:
            self._orders[order.id] = order
        return order

    def pay(self, order_id: str, outcome: FakeOutcome) -> ProviderPayment:
        """What the stand-in checkout does when a button is pressed."""
        with self._lock:
            order = self._orders.get(order_id)
            if order is None:
                raise ProviderError("No such fake order")
            payment = ProviderPayment(
                id=f"pay_{secrets.token_hex(7)}",
                order_id=order.id,
                amount_paise=order.amount_paise,
                currency=order.currency,
                status=outcome,
                method="upi",
                error_code="BAD_REQUEST_ERROR" if outcome == "failed" else None,
            )
            self._payments[payment.id] = payment
        return payment

    def sign(self, order_id: str, payment_id: str) -> str:
        return payment_signature(self.SECRET, order_id, payment_id)

    def fetch_payment(self, payment_id: str) -> ProviderPayment:
        with self._lock:
            payment = self._payments.get(payment_id)
        if payment is None:
            raise ProviderError("Razorpay refused the request (HTTP 400)")
        return payment

    def signature_valid(self, order_id: str, payment_id: str, signature: str) -> bool:
        return signature_matches(self.SECRET, order_id, payment_id, signature)

    def order_payments(self, order_id: str) -> list[ProviderPayment]:
        with self._lock:
            return [p for p in self._payments.values() if p.order_id == order_id]

    def refund(self, payment_id: str, amount_paise: int, receipt: str) -> Refund:
        """A refund the stand-in processes at once (Razorpay may leave one pending)."""
        with self._lock:
            payment = self._payments.get(payment_id)
            if payment is None or payment.status not in ("captured", "refunded"):
                raise ProviderError("Razorpay refused the request (HTTP 400)")
            for known in self._refunds.get(payment_id, []):
                if known.receipt == receipt:
                    return known
            if payment.refunded_paise + amount_paise > payment.amount_paise:
                raise ProviderError("Razorpay refused the request (HTTP 400)")
            status: RefundStatus = self.refund_outcome
            refund = Refund(
                f"rfnd_{secrets.token_hex(7)}", payment_id, amount_paise, status, receipt
            )
            self._refunds.setdefault(payment_id, []).append(refund)
            if status == "processed":
                total = payment.refunded_paise + amount_paise
                self._payments[payment_id] = dataclasses.replace(
                    payment,
                    refunded_paise=total,
                    status="refunded" if total == payment.amount_paise else payment.status,
                )
        return refund

    def payment_refunds(self, payment_id: str) -> list[Refund]:
        with self._lock:
            return list(self._refunds.get(payment_id, []))


FAKE_PROVIDER = FakeProvider()


def provider_for(settings: Settings) -> PaymentProvider | None:
    """The configured provider, or None when payments aren't set up."""
    if settings.payment_provider == "fake":
        # Settings already refuse "fake" in production; checked again here regardless.
        return FAKE_PROVIDER if settings.app_env != "production" else None
    if settings.razorpay_configured:
        return RazorpayClient(settings)
    return None


def webhook_secret_for(settings: Settings, provider: PaymentProvider | None) -> str | None:
    """The secret webhooks must be signed with, or None when webhooks aren't set up."""
    if provider is FAKE_PROVIDER and settings.app_env != "production":
        return FakeProvider.WEBHOOK_SECRET
    if settings.payment_provider == "razorpay" and settings.razorpay_webhook_secret is not None:
        return settings.razorpay_webhook_secret.get_secret_value()
    return None
