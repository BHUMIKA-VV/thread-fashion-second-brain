"""M14-3: the Razorpay client (against a mocked API), signatures and the key settings.

No test talks to Razorpay: every request goes to an httpx.MockTransport.
"""

import json

import httpx
import pytest
from pydantic import ValidationError

from app.billing.razorpay import (
    API_BASE,
    FakeProvider,
    ProviderError,
    ProviderUnavailable,
    RazorpayClient,
    method_kind,
    payment_signature,
    provider_for,
    signature_matches,
)
from app.core.config import Settings

KEY_ID = "rzp_test_abc123"
SECRET = "test-secret-value"  # noqa: S105 (a made-up test value)


def settings(**overrides: object) -> Settings:
    values = {"razorpay_key_id": KEY_ID, "razorpay_key_secret": SECRET, **overrides}
    return Settings(**values)  # type: ignore[arg-type]


def client(handler: httpx.MockTransport) -> RazorpayClient:
    return RazorpayClient(settings(), transport=handler)


PAYMENT = {
    "id": "pay_29QQoUBi66xm2f",
    "entity": "payment",
    "amount": 99900,
    "currency": "INR",
    "status": "captured",
    "order_id": "order_9A33XWu170gUtm",
    "method": "card",
    "email": "someone@example.com",
    "contact": "+919000090000",
    "card": {"last4": "1111", "network": "Visa"},
    "error_code": None,
}


# --- signatures ----------------------------------------------------------------------------


def test_the_signature_is_hmac_sha256_of_order_and_payment_ids() -> None:
    # Computed independently: echo -n "order_X|pay_Y" | openssl dgst -sha256 -hmac secret
    import hashlib
    import hmac

    expected = hmac.new(b"secret", b"order_X|pay_Y", hashlib.sha256).hexdigest()
    assert payment_signature("secret", "order_X", "pay_Y") == expected


def test_only_the_exact_signature_matches() -> None:
    good = payment_signature(SECRET, "order_A1", "pay_B2")
    assert signature_matches(SECRET, "order_A1", "pay_B2", good)
    assert not signature_matches("another-secret", "order_A1", "pay_B2", good)
    # Signed for another order or another payment.
    assert not signature_matches(SECRET, "order_A2", "pay_B2", good)
    assert not signature_matches(SECRET, "order_A1", "pay_B3", good)
    for malformed in ("", good.upper(), good[:-1], good + "0", "x" * 64):
        assert not signature_matches(SECRET, "order_A1", "pay_B2", malformed)
    assert not signature_matches(SECRET, "order_A1", "not_a_payment", good)


def test_only_the_kind_of_method_is_kept() -> None:
    assert [method_kind(m) for m in ("card", "upi", "netbanking", "wallet")] == [
        "card",
        "upi",
        "netbanking",
        "wallet",
    ]
    assert [method_kind(m) for m in ("emi", "paylater", "cardless_emi")] == ["other"] * 3
    assert method_kind(None) is None
    assert method_kind("") is None


# --- the API client ------------------------------------------------------------------------


def test_an_order_is_created_with_basic_auth_and_the_amount_given() -> None:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        body = json.loads(request.content)
        return httpx.Response(
            200,
            json={"id": "order_EKwxwAgItmmXdp", "amount": body["amount"], "currency": "INR"},
        )

    order = client(httpx.MockTransport(handle)).create_order(
        99_900, "INR", "thr_0123", {"plan": "studio"}
    )
    assert (order.id, order.amount_paise, order.currency) == ("order_EKwxwAgItmmXdp", 99_900, "INR")
    request = seen[0]
    assert str(request.url) == f"{API_BASE}/orders"
    assert request.headers["authorization"].startswith("Basic ")
    assert json.loads(request.content) == {
        "amount": 99_900,
        "currency": "INR",
        "receipt": "thr_0123",
        "notes": {"plan": "studio"},
    }


def test_a_payment_is_read_without_any_personal_details() -> None:
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json=PAYMENT))
    payment = client(transport).fetch_payment("pay_29QQoUBi66xm2f")
    assert payment.status == "captured"
    assert payment.method == "card"
    stored = repr(payment)
    for personal in ("someone@example.com", "+919000090000", "1111", "Visa"):
        assert personal not in stored


@pytest.mark.parametrize(
    "body",
    [
        {**PAYMENT, "status": "settled"},
        {**PAYMENT, "amount": "99900"},
        {**PAYMENT, "order_id": "order_with spaces"},
        {**PAYMENT, "id": "evil"},
        {k: v for k, v in PAYMENT.items() if k != "order_id"},
        ["not", "an", "object"],
    ],
)
def test_malformed_payments_are_refused(body: object) -> None:
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json=body))
    with pytest.raises(ProviderError):
        client(transport).fetch_payment("pay_29QQoUBi66xm2f")


def test_an_unknown_error_code_is_not_stored_verbatim() -> None:
    body = {**PAYMENT, "status": "failed", "error_code": "anything <b>at all</b>"}
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json=body))
    assert client(transport).fetch_payment("pay_29QQoUBi66xm2f").error_code == "UNKNOWN_ERROR"


def test_a_payment_id_that_is_not_one_is_never_put_in_a_url() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no request should be made")

    with pytest.raises(ProviderError):
        client(httpx.MockTransport(handle)).fetch_payment("../orders")


@pytest.mark.parametrize(
    ("status", "error"),
    [(401, ProviderUnavailable), (500, ProviderUnavailable), (429, ProviderUnavailable)],
)
def test_razorpay_being_down_or_refusing_the_keys_is_unavailable(
    status: int, error: type[Exception]
) -> None:
    transport = httpx.MockTransport(lambda r: httpx.Response(status, json={}))
    with pytest.raises(error):
        client(transport).create_order(99_900, "INR", "thr_1", {})


def test_a_refused_request_is_a_provider_error() -> None:
    body = {"error": {"code": "BAD_REQUEST_ERROR", "description": "amount too small"}}
    transport = httpx.MockTransport(lambda r: httpx.Response(400, json=body))
    with pytest.raises(ProviderError):
        client(transport).create_order(99_900, "INR", "thr_1", {})


def test_network_failures_are_unavailable() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out", request=request)

    with pytest.raises(ProviderUnavailable):
        client(httpx.MockTransport(handle)).fetch_payment("pay_29QQoUBi66xm2f")


# --- settings ------------------------------------------------------------------------------


def test_live_keys_are_refused_and_the_error_never_shows_a_value() -> None:
    with pytest.raises(ValidationError) as refused:
        settings(razorpay_key_id="rzp_live_abcdef", razorpay_key_secret="live-secret-123")  # noqa: S106
    assert "test key" in str(refused.value)
    assert "live-secret-123" not in str(refused.value)
    assert "rzp_live_abcdef" not in str(refused.value)


def test_test_mode_is_the_only_mode() -> None:
    with pytest.raises(ValidationError):
        settings(razorpay_mode="live")


def test_keys_come_in_pairs() -> None:
    with pytest.raises(ValidationError, match="together"):
        settings(razorpay_key_secret=None)
    with pytest.raises(ValidationError, match="together"):
        settings(razorpay_key_id="")


def test_without_keys_there_is_no_provider() -> None:
    assert provider_for(settings(razorpay_key_id=None, razorpay_key_secret=None)) is None
    assert isinstance(provider_for(settings()), RazorpayClient)


def test_the_fake_provider_is_never_used_in_production() -> None:
    with pytest.raises(ValidationError, match="fake"):
        settings(app_env="production", payment_provider="fake")
    assert isinstance(provider_for(settings(payment_provider="fake")), FakeProvider)


def test_the_fake_provider_signs_only_its_own_payments() -> None:
    fake = FakeProvider()
    order = fake.create_order(99_900, "INR", "thr_1", {})
    payment = fake.pay(order.id, "captured")
    assert fake.signature_valid(order.id, payment.id, fake.sign(order.id, payment.id))
    assert not fake.signature_valid(
        order.id, payment.id, payment_signature(SECRET, order.id, payment.id)
    )
