"""The Claude client through the real SDK, on a mock HTTP transport: no network, no real key."""

import io
import json
import logging
from collections.abc import Callable

import httpx2
import pytest
from PIL import Image, ImageCms

from app.ml.deep_analyzer import (
    MAX_LONG_EDGE,
    AnalysisInput,
    ClaudeDeepAnalyzer,
    DeepAnalysisError,
    prepare_image,
)

KEY = "sk-test-not-a-real-key-4c1d"
RESULT = {
    "summary": "A red cotton kurta with ikat borders.",
    "is_fashion_image": True,
    "garment": "kurta",
    "silhouette": "straight, knee length",
    "pattern": "ikat border",
    "fabric": {"guess": "cotton-like plain weave", "confidence": "medium", "reasoning": "Matte."},
    "crafts": [{"name": "ikat", "confidence": "medium", "evidence": "Blurred chevron edges."}],
    "styling_ideas": ["Pair with white churidar"],
    "occasions": ["day wear"],
    "caveats": ["Only the front is visible."],
}

Handler = Callable[[httpx2.Request], httpx2.Response]


def message(text: str, stop_reason: str = "end_turn", **extra: object) -> httpx2.Response:
    return httpx2.Response(
        200,
        json={
            "id": "msg_test",
            "type": "message",
            "role": "assistant",
            "model": "claude-opus-5-5",
            "content": [{"type": "text", "text": text}],
            "stop_reason": stop_reason,
            "stop_sequence": None,
            "usage": {"input_tokens": 5100, "output_tokens": 420},
            **extra,
        },
    )


def api_error(status: int, kind: str, headers: dict[str, str] | None = None) -> httpx2.Response:
    return httpx2.Response(
        status,
        headers={"request-id": "req_test", **(headers or {})},
        json={"type": "error", "error": {"type": kind, "message": f"{kind} for {KEY}?"}},
    )


def analyzer(handler: Handler) -> ClaudeDeepAnalyzer:
    return ClaudeDeepAnalyzer(
        api_key=KEY,
        base_url="https://api.anthropic.com",
        model="claude-opus-5-5",
        effort="medium",
        timeout=5,
        max_retries=0,
        transport=httpx2.MockTransport(handler),
    )


def png(size: tuple[int, int] = (64, 96), colour: tuple[int, int, int] = (200, 30, 40)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, colour).save(buffer, "PNG")
    return buffer.getvalue()


SAMPLE = AnalysisInput(
    image_jpeg=prepare_image(png(), 40_000_000),
    colour_names=["sindoor red"],
    tags=[("craft", "ikat")],
)


def test_the_request_uses_only_thread_settings_whatever_the_environment_says(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-machine-wide-key")
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "machine-wide-token")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://elsewhere.example")
    monkeypatch.setenv("ANTHROPIC_CUSTOM_HEADERS", "X-Injected: 1\nX-Other: 2")
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:9")
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return message(json.dumps(RESULT))

    output = analyzer(handler).analyze(SAMPLE)

    request = seen[0]
    assert str(request.url) == "https://api.anthropic.com/v1/messages"
    assert request.headers["authorization"] == f"Bearer {KEY}"
    assert "x-api-key" not in request.headers
    assert not {"x-injected", "x-other"} & {name.lower() for name in request.headers}
    body = json.loads(request.content)
    assert body["model"] == "claude-opus-5-5"
    assert body["output_config"]["effort"] == "medium"
    assert body["output_config"]["format"]["type"] == "json_schema"
    assert not {"temperature", "top_p", "top_k"} & set(body)
    image, hints = body["messages"][0]["content"]
    assert image["source"]["media_type"] == "image/jpeg"
    assert "may be wrong" in hints["text"] and "sindoor red" in hints["text"]
    assert "craft: ikat" in hints["text"]
    assert output.result.garment == "kurta" and output.model == "claude-opus-5-5"
    assert (output.input_tokens, output.output_tokens) == (5100, 420)


def test_the_default_transport_ignores_system_proxies_and_redirects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:9")
    monkeypatch.setenv("ALL_PROXY", "http://127.0.0.1:9")
    client = ClaudeDeepAnalyzer(
        api_key=KEY,
        base_url="https://api.anthropic.com",
        model="claude-opus-5-5",
        effort="medium",
        timeout=5,
    )._client._client
    assert client.trust_env is False
    assert client.follow_redirects is False
    assert not client._mounts  # no proxy routes taken from the environment


@pytest.mark.parametrize(
    ("response", "code", "retry_after"),
    [
        (api_error(401, "authentication_error"), "key_rejected", None),
        (api_error(403, "permission_error"), "key_rejected", None),
        (api_error(429, "rate_limit_error", {"retry-after": "12"}), "rate_limited", 12),
        (api_error(529, "overloaded_error"), "provider_unavailable", None),
        (api_error(500, "api_error"), "provider_unavailable", None),
        (api_error(400, "invalid_request_error"), "request_rejected", None),
        (api_error(404, "not_found_error"), "request_rejected", None),
        (message("not json at all"), "invalid_output", None),
        (
            message(json.dumps({**RESULT, "crafts": [RESULT["crafts"][0]] * 6})),
            "invalid_output",
            None,
        ),
        (message(json.dumps({"summary": "missing fields"})), "invalid_output", None),
        (message("", stop_reason="refusal"), "declined", None),
        (message('{"summary": "A red', stop_reason="max_tokens"), "incomplete", None),
    ],
)
def test_provider_outcomes_map_to_safe_errors(
    response: httpx2.Response,
    code: str,
    retry_after: int | None,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    with pytest.raises(DeepAnalysisError) as raised:
        analyzer(lambda _: response).analyze(SAMPLE)

    assert raised.value.code == code
    assert raised.value.retry_after == retry_after
    assert KEY not in raised.value.message
    assert KEY not in caplog.text  # not even when the provider echoes it back


@pytest.mark.parametrize(
    ("exception", "code"),
    [(httpx2.ReadTimeout("slow"), "timeout"), (httpx2.ConnectError("down"), "network")],
)
def test_network_failures_map_to_safe_errors(
    exception: Exception, code: str, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)

    def handler(_: httpx2.Request) -> httpx2.Response:
        raise exception

    with pytest.raises(DeepAnalysisError) as raised:
        analyzer(handler).analyze(SAMPLE)
    assert raised.value.code == code
    assert KEY not in caplog.text


def test_the_key_is_never_logged_on_success(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    analyzer(lambda _: message(json.dumps(RESULT))).analyze(SAMPLE)
    assert KEY not in caplog.text
    assert "claude-opus-5-5" in caplog.text  # the outcome itself is logged


# --- the image that is sent ------------------------------------------------------------------


def test_the_sent_image_is_upright_resized_and_has_no_metadata() -> None:
    image = Image.new("RGB", (6000, 3000), (10, 120, 60))
    exif = image.getexif()
    exif[0x0112] = 6  # orientation: rotate 90 degrees to display
    exif[0x010F] = "SecretCam"  # camera make
    gps = exif.get_ifd(0x8825)
    gps[2] = (12.0, 58.0, 0.0)  # latitude
    buffer = io.BytesIO()
    image.save(
        buffer,
        "JPEG",
        exif=exif,
        icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes(),
    )

    sent = prepare_image(buffer.getvalue(), 40_000_000)

    assert b"SecretCam" not in sent
    with Image.open(io.BytesIO(sent)) as out:
        assert out.format == "JPEG"
        assert out.size == (MAX_LONG_EDGE // 2, MAX_LONG_EDGE)  # rotated upright, then resized
        assert not out.getexif() and "icc_profile" not in out.info


def test_transparent_images_get_a_white_background() -> None:
    buffer = io.BytesIO()
    Image.new("RGBA", (40, 40), (255, 0, 0, 0)).save(buffer, "PNG")
    with Image.open(io.BytesIO(prepare_image(buffer.getvalue(), 40_000_000))) as out:
        assert out.mode == "RGB" and min(out.getpixel((20, 20))) > 240


def test_small_images_are_not_enlarged() -> None:
    with Image.open(io.BytesIO(prepare_image(png((300, 200)), 40_000_000))) as out:
        assert out.size == (300, 200)


@pytest.mark.parametrize("data", [b"not an image", png((100, 100))])
def test_unreadable_or_oversized_images_fail_safely(data: bytes) -> None:
    with pytest.raises(DeepAnalysisError) as raised:
        prepare_image(data, max_pixels=5_000)  # 100x100 exceeds this tiny limit
    assert raised.value.code == "image_unreadable"
