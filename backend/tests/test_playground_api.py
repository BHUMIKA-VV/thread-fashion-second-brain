"""The public playground: one photo analysed in memory by the app's own code, compared only
with the public demo, never stored, and limited so it stays cheap."""

import io
import json
import logging
import os
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.api.routes.playground import get_playground_service
from app.core.config import get_settings
from app.db.session import get_db
from app.main import app
from app.ml import model_spec, registry
from app.models.enums import ItemType
from app.services import playground
from app.services.playground import DemoIndex, PlaygroundService, demo_index
from tests.fakes import FakeEmbedder

URL = "/playground/analyse"
DEMO = Path(__file__).resolve().parents[2] / "frontend" / "public" / "demo"


def photo(
    colour: tuple[int, int, int] = (150, 30, 40),
    size: tuple[int, int] = (300, 400),
    fmt: str = "PNG",
) -> bytes:
    image = Image.new("RGB", size, (240, 238, 232))
    image.paste(colour, (size[0] // 5, size[1] // 8, size[0] * 4 // 5, size[1] * 7 // 8))
    buffer = io.BytesIO()
    image.save(buffer, format=fmt)
    return buffer.getvalue()


def post(client: TestClient, data: bytes, **params: str):  # noqa: ANN201
    return client.post(URL, content=data, params=params, headers={"Content-Type": "image/png"})


def fake_index(*colours: tuple[str, tuple[int, int, int]]) -> DemoIndex:
    """A demo index made by the fake embedder, from solid-colour 'pieces'."""
    from app.color.palette import extract_palette

    pieces = []
    for pid, colour in colours:
        image = Image.open(io.BytesIO(photo(colour)))
        palette = [
            {
                "hex": c.hex,
                "name": c.name,
                "family": c.family,
                "percentage": c.percentage,
                "lab": c.lab,
            }
            for c in extract_palette(image, 6).colors
        ]
        vector = FakeEmbedder().embed(image)
        pieces.append(
            playground.DemoPiece(
                pid, pid.title(), ItemType.GARMENT, f"thumbs/{pid}.webp", palette, vector
            )
        )
    return DemoIndex(FakeEmbedder.model_name, pieces)


@pytest.fixture
def with_index(client: TestClient):  # noqa: ANN201
    def use(index: DemoIndex) -> None:
        app.dependency_overrides[get_playground_service] = lambda: PlaygroundService(
            get_settings(), index
        )

    return use


def test_the_shipped_index_matches_the_published_demo() -> None:
    index = demo_index()
    published = json.loads((DEMO / "demo.json").read_text(encoding="utf-8"))
    assert index.model == published["model"] == model_spec.MODEL_NAME
    assert [p.id for p in index.pieces] == [p["id"] for p in published["pieces"]]
    for piece, shown in zip(index.pieces, published["pieces"], strict=True):
        assert piece.palette == shown["palette"]
        assert piece.thumbnail == shown["thumbnail"] and (DEMO / piece.thumbnail).is_file()
        assert piece.vector is not None and piece.vector.shape == (512,)
        assert abs(float(np.linalg.norm(piece.vector)) - 1) < 1e-5


def test_measures_the_palette_and_suggests_tags(client: TestClient) -> None:
    response = post(client, photo())
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert (body["width"], body["height"]) == (300, 400)
    assert body["model"] == "ready"
    assert body["palette"] and abs(sum(c["percentage"] for c in body["palette"]) - 100) < 1
    assert {"hex", "name", "family", "percentage"} == set(body["palette"][0])
    assert body["harmony"] in {"monochromatic", "analogous", "complementary", "neutral", "mixed"}
    assert body["tags"] and all(0 <= t["score"] <= 1 for t in body["tags"])
    # Palette matches come from the 20 public demo pieces, closest first.
    distances = [m["distance"] for m in body["similar_palette"]]
    assert len(distances) == playground.SIMILAR and distances == sorted(distances)
    assert {m["id"] for m in body["similar_palette"]} <= {p.id for p in demo_index().pieces}


def test_look_alikes_need_the_model_that_indexed_the_demo(client: TestClient, with_index) -> None:  # noqa: ANN001
    # The shipped demo was indexed by the real model, so the fake one may not compare with it.
    body = post(client, photo()).json()
    assert (
        body["model"] == "ready" and body["look_compared"] is False and body["similar_look"] == []
    )

    with_index(
        fake_index(
            ("blue-coat", (30, 50, 160)),
            ("red-dress", (160, 30, 40)),
            ("green-shawl", (30, 140, 60)),
        )
    )
    body = post(client, photo((150, 30, 40))).json()
    assert body["look_compared"] is True
    assert [m["id"] for m in body["similar_look"]][0] == "red-dress"
    assert body["similar_look"][0]["similarity"] > body["similar_look"][1]["similarity"]
    assert body["similar_palette"][0]["id"] == "red-dress"


def test_type_is_chosen_suggested_or_left_as_other(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    chosen = post(client, photo(), type="fabric").json()
    assert (chosen["type"], chosen["type_source"]) == ("fabric", "chosen")
    monkeypatch.setattr(registry._tagger, "suggest_type", lambda _: None)
    assert post(client, photo()).json()["type_source"] == "default"
    assert post(client, photo(), type="shoe").status_code == 422


def test_without_the_model_only_the_palette_is_given(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    registry._embedder, registry._tagger = None, None
    monkeypatch.setattr(
        registry,
        "get_embedder_nowait",
        lambda: (_ for _ in ()).throw(registry.EmbedderLoading("…")),
    )
    body = post(client, photo()).json()
    assert body["model"] == "loading"
    assert body["palette"] and body["similar_palette"]
    assert body["tags"] == [] and body["similar_look"] == [] and body["type_source"] == "default"

    monkeypatch.setattr(
        registry,
        "get_embedder_nowait",
        lambda: (_ for _ in ()).throw(registry.EmbedderUnavailable("…")),
    )
    assert post(client, photo()).json()["model"] == "unavailable"


def test_nothing_is_stored_logged_or_spooled(
    client: TestClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    # No database: the route has no session, and one asked for would fail the request.
    app.dependency_overrides[get_db] = lambda: pytest.fail(
        "the playground opened a database session"
    )
    # No files: the storage root and the temp folder are unchanged after a 2 MB+ photo (a
    # multipart upload would have been spooled to a temporary file past 1 MB).
    temp = tmp_path / "tmp"
    temp.mkdir()
    monkeypatch.setenv("TMP", str(temp))
    monkeypatch.setenv("TEMP", str(temp))
    monkeypatch.setattr("tempfile.tempdir", str(temp))
    storage = get_settings().storage_root
    before = sorted(storage.rglob("*")) if storage.exists() else []
    noise = np.random.default_rng(1).integers(0, 255, (1200, 900, 3), dtype=np.uint8)
    buffer = io.BytesIO()
    Image.fromarray(noise).save(buffer, format="PNG")
    assert len(buffer.getvalue()) > 2 * 1024 * 1024

    with caplog.at_level(logging.DEBUG, logger="app"):
        assert post(client, buffer.getvalue()).status_code == 200
    assert os.listdir(temp) == []
    assert (sorted(storage.rglob("*")) if storage.exists() else []) == before
    assert [r for r in caplog.records if r.name.startswith("app")] == []


@pytest.mark.parametrize(
    ("data", "status", "code"),
    [
        (b"", 422, "invalid_image"),
        (b"not an image at all", 422, "invalid_image"),
        (photo(fmt="GIF"), 415, "unsupported_format"),
        (photo(size=(40, 40)), 422, "bad_dimensions"),
        (photo(size=(4000, 3100)), 422, "bad_dimensions"),  # 12.4 MP: over the playground's 12
    ],
    ids=["empty", "not-an-image", "gif", "too-small", "too-many-pixels"],
)
def test_refuses_what_an_upload_would_and_more(
    client: TestClient, data: bytes, status: int, code: str
) -> None:
    response = post(client, data)
    assert response.status_code == status
    assert response.json()["error"]["code"] == code


def test_refuses_a_file_over_8_mb_without_reading_it(client: TestClient) -> None:
    big = b"\x89PNG" + b"0" * (playground.MAX_BYTES + 1)
    response = post(client, big)
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "too_large"


def test_limits_each_network_and_everyone(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    for _ in range(playground.PER_IP_PER_HOUR):
        assert post(client, b"junk").status_code == 422  # refused photos count too
    refused = post(client, photo())
    assert refused.status_code == 429
    assert int(refused.headers["retry-after"]) > 0

    from app.services.rate_limit import limiter

    limiter.reset()
    monkeypatch.setattr(playground, "DAILY_CAP", 2)
    monkeypatch.setattr(playground, "PER_IP_PER_HOUR", 100)
    assert post(client, photo()).status_code == 200
    assert post(client, photo()).status_code == 200
    assert post(client, photo()).json()["error"]["code"] == "rate_limited"


def test_says_busy_when_two_photos_are_already_being_analysed(client: TestClient) -> None:
    held = [playground._slots.acquire(blocking=False) for _ in range(playground.CONCURRENT)]
    try:
        assert all(held)
        response = post(client, photo())
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "busy"
        assert response.headers["retry-after"] == "5"
    finally:
        for _ in held:
            playground._slots.release()
    assert post(client, photo()).status_code == 200  # the slots are given back


def test_another_site_cannot_post_a_photo(client: TestClient) -> None:
    response = client.post(URL, content=photo(), headers={"Origin": "https://evil.example"})
    assert response.status_code == 403


@pytest.mark.ml
@pytest.mark.skipif(
    not model_spec.weights_path(get_settings().model_cache_root).is_file(),
    reason="OpenCLIP weights not installed",
)
def test_with_the_real_model_a_demo_photo_finds_itself_first(client: TestClient) -> None:
    registry.get_embedder()  # load now, as the warm-up would in the running API
    data = (DEMO / "images" / "bandhani-odhani.webp").read_bytes()
    body = client.post(URL, content=data, headers={"Content-Type": "image/webp"}).json()
    assert body["model"] == "ready" and body["look_compared"] is True
    top = body["similar_look"][0]
    assert top["id"] == "bandhani-odhani" and top["similarity"] > 0.9
    assert body["similar_palette"][0]["id"] == "bandhani-odhani"
    assert body["tags"]
