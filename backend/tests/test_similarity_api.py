"""Embeddings and owner-scoped similarity search through the API (real Postgres + pgvector)."""

from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.ml import registry
from app.models import Embedding, Item, User
from tests.conftest import make_item, upload
from tests.fakes import FakeEmbedder
from tests.images import blocks, encode

pytestmark = pytest.mark.db

RED = (200, 30, 40)
NEAR_RED = (190, 45, 50)
ORANGE = (230, 120, 30)
BLUE = (30, 60, 180)


def png(colour: tuple[int, int, int], accent: tuple[int, int, int] = (240, 240, 240)) -> bytes:
    """A colour field with a small accent stripe (the accent keeps each file unique)."""
    return encode(blocks((300, 400), colour, [((0, 360, 300, 400), accent)]))


def add(
    api: TestClient, colour: tuple[int, int, int], accent: tuple[int, int, int] = (240, 240, 240)
) -> dict[str, Any]:
    response = upload(api, png(colour, accent), content_type="image/png")
    assert response.status_code == 201, response.text
    return response.json()


def similar(api: TestClient, item_id: str, **params: Any) -> Any:
    return api.get(f"/items/{item_id}/similar", params=params)


def no_model(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Simulate a machine without the weights installed."""
    settings = get_settings().model_copy(update={"model_cache_dir": tmp_path / "empty"})
    monkeypatch.setattr(registry, "get_settings", lambda: settings)
    registry.reset_for_tests()


# --- indexing ----------------------------------------------------------------------------


def test_upload_stores_a_unit_length_512_d_vector(
    api: TestClient, db: Session, fake_embedder: FakeEmbedder
) -> None:
    item = add(api, RED)

    assert item["stage_status"]["embedding"] == "completed"
    row = db.get(Embedding, item["id"])
    assert row is not None
    vector = np.asarray(row.vector)
    assert vector.shape == (512,)
    assert np.linalg.norm(vector) == pytest.approx(1.0, abs=1e-5)
    assert row.model_name == fake_embedder.model_name


def test_reindex_endpoint_upserts(api: TestClient, db: Session) -> None:
    item = add(api, RED)

    response = api.post(f"/items/{item['id']}/embedding")

    assert response.status_code == 200
    assert response.json()["stage_status"]["embedding"] == "completed"
    assert db.scalar(select(func.count()).select_from(Embedding)) == 1


# --- ranking -----------------------------------------------------------------------------


def test_similar_items_are_ranked_by_cosine_similarity(api: TestClient) -> None:
    query = add(api, RED)
    near = add(api, NEAR_RED)
    middle = add(api, ORANGE)
    far = add(api, BLUE)

    response = similar(api, query["id"])

    assert response.status_code == 200
    body = response.json()
    ids = [r["item"]["id"] for r in body["results"]]
    assert ids == [near["id"], middle["id"], far["id"]]
    scores = [r["similarity"] for r in body["results"]]
    assert scores == sorted(scores, reverse=True)
    assert all(-1 <= s <= 1 for s in scores)
    assert query["id"] not in ids  # never matches itself
    assert (body["compared"], body["not_indexed"]) == (3, 0)
    assert body["model"].startswith("open_clip/ViT-B-32/")
    assert body["results"][0]["item"]["thumbnail_url"].endswith("variant=thumbnail")


def test_limit(api: TestClient) -> None:
    query = add(api, RED)
    for accent in [(1, 2, 3), (4, 5, 6), (7, 8, 9)]:
        add(api, NEAR_RED, accent)

    assert len(similar(api, query["id"], limit=2).json()["results"]) == 2
    assert similar(api, query["id"], limit=0).status_code == 422
    assert similar(api, query["id"], limit=51).status_code == 422


def test_library_with_one_item_returns_no_results(api: TestClient) -> None:
    only = add(api, RED)
    body = similar(api, only["id"]).json()
    assert body["results"] == [] and body["compared"] == 0


# --- ownership ---------------------------------------------------------------------------


def test_other_users_items_never_appear_and_cannot_be_queried(
    api: TestClient,
    db: Session,
    stranger: User,
    fake_embedder: FakeEmbedder,
) -> None:
    query = add(api, RED)
    mine = add(api, BLUE)
    # A stranger's item whose vector is IDENTICAL to the query: the best possible match.
    theirs = make_item(db, stranger)
    query_vector = db.get(Embedding, query["id"]).vector  # type: ignore[union-attr]
    db.add(Embedding(item_id=theirs.id, model_name=fake_embedder.model_name, vector=query_vector))
    db.flush()

    ids = [r["item"]["id"] for r in similar(api, query["id"]).json()["results"]]

    assert ids == [mine["id"]]
    assert similar(api, str(theirs.id)).status_code == 404
    assert api.post(f"/items/{theirs.id}/embedding").status_code == 404


# --- missing embeddings, unavailable model, failures --------------------------------------


def test_items_uploaded_before_the_model_loaded_are_indexed_on_demand(
    api: TestClient,
    db: Session,
    fake_embedder: FakeEmbedder,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Model not loaded yet but weights "installed": uploads are marked pending, not blocked.
    monkeypatch.setattr(registry, "_embedder", None)
    monkeypatch.setattr(registry, "status", lambda: {"weights_present": True, "state": "loading"})
    query = add(api, RED)
    near = add(api, NEAR_RED)
    assert query["stage_status"]["embedding"] == "pending"
    assert query["processing_status"] == "queued"
    assert db.scalar(select(func.count()).select_from(Embedding)) == 0

    monkeypatch.setattr(registry, "_embedder", fake_embedder)  # the model finished loading
    body = similar(api, query["id"]).json()

    assert [r["item"]["id"] for r in body["results"]] == [near["id"]]
    assert db.scalar(select(func.count()).select_from(Embedding)) == 2
    refreshed = api.get(f"/items/{near['id']}").json()
    assert refreshed["stage_status"]["embedding"] == "completed"
    assert refreshed["processing_status"] == "completed"


def test_without_weights_uploads_and_palettes_still_work(
    api: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    no_model(monkeypatch, tmp_path)

    item = add(api, RED)

    assert item["palette"] is not None  # palette extraction unaffected
    assert item["stage_status"]["palette"] == "completed"
    assert item["stage_status"]["embedding"] == "unavailable"
    assert item["processing_status"] == "partially_completed"
    response = similar(api, item["id"])
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "model_unavailable"
    assert "fetch_model" in response.json()["error"]["message"]
    assert api.post(f"/items/{item['id']}/embedding").status_code == 503
    assert db.scalar(select(func.count()).select_from(Embedding)) == 0
    health = api.get("/health").json()["embedding_model"]
    assert health["state"] == "unavailable" and health["weights_present"] is False


def test_requests_during_a_model_load_get_a_quick_retry_hint(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    item = add(api, RED)

    def loading() -> None:
        raise registry.EmbedderLoading(registry.LOADING_MESSAGE)

    monkeypatch.setattr(registry, "get_embedder_nowait", loading)

    for response in (similar(api, item["id"]), api.post(f"/items/{item['id']}/embedding")):
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "model_loading"
        assert response.headers["retry-after"] == "5"


def test_embedding_failure_is_recorded_and_never_breaks_the_upload(
    api: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(registry, "_embedder", FakeEmbedder(fail=True))

    item = add(api, RED)

    assert item["stage_status"]["embedding"] == "failed"
    assert item["stage_status"]["palette"] == "completed"
    response = similar(api, item["id"])
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "embedding_failed"
    assert db.scalar(select(func.count()).select_from(Embedding)) == 0


def test_items_that_failed_are_counted_not_retried_on_every_search(
    api: TestClient,
    fake_embedder: FakeEmbedder,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    failing = FakeEmbedder(fail=True)
    monkeypatch.setattr(registry, "_embedder", failing)
    add(api, BLUE)  # fails to index
    monkeypatch.setattr(registry, "_embedder", fake_embedder)
    query = add(api, RED)
    calls_before = fake_embedder.calls

    body = similar(api, query["id"]).json()

    assert body["results"] == []
    assert (body["compared"], body["not_indexed"]) == (0, 1)
    assert fake_embedder.calls == calls_before  # the known failure was not retried


def test_vectors_from_another_model_are_reindexed_not_compared(
    api: TestClient,
    db: Session,
    fake_embedder: FakeEmbedder,
) -> None:
    query = add(api, RED)
    other = add(api, NEAR_RED)
    stale = db.get(Embedding, other["id"])
    assert stale is not None
    stale.model_name = "some-older-model"
    db.flush()

    ids = [r["item"]["id"] for r in similar(api, query["id"]).json()["results"]]

    assert ids == [other["id"]]
    db.expire_all()
    assert db.get(Embedding, other["id"]).model_name == fake_embedder.model_name  # type: ignore[union-attr]
    assert db.get(Item, other["id"]) is not None
