"""Palette and fabric similarity modes (real Postgres; tags controlled explicitly)."""

from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.color.compare import dominant_family, palette_distance
from app.color.lab import srgb_to_lab
from app.core.config import get_settings
from app.ml import registry
from app.models import Embedding, Palette, User
from tests.conftest import make_item, upload
from tests.images import blocks, encode

RED = (200, 30, 40)
NEAR_RED = (190, 45, 50)
ORANGE = (230, 120, 30)
BLUE = (30, 60, 180)


def colour(rgb: tuple[int, int, int], share: float, family: str = "x") -> dict[str, Any]:
    return {"lab": [float(v) for v in srgb_to_lab(rgb)], "percentage": share, "family": family}


# --- palette distance (pure maths) ------------------------------------------------------------


def test_identical_palettes_have_zero_distance() -> None:
    p = [colour(RED, 70), colour(BLUE, 30)]
    assert palette_distance(p, p) == 0.0


def test_distance_is_symmetric_and_orders_sensibly() -> None:
    red, near_red, blue = [colour(RED, 100)], [colour(NEAR_RED, 100)], [colour(BLUE, 100)]
    assert palette_distance(red, blue) == palette_distance(blue, red)
    assert palette_distance(red, near_red) < palette_distance(red, blue)


def test_shares_weight_the_distance() -> None:
    """A big red area matters more than a small accent of the same red."""
    mostly_red = [colour(RED, 90), colour(BLUE, 10)]
    mostly_blue = [colour(RED, 10), colour(BLUE, 90)]
    only_red = [colour(RED, 100)]
    assert palette_distance(only_red, mostly_red) < palette_distance(only_red, mostly_blue)


def test_a_missing_accent_is_not_ignored() -> None:
    plain = [colour(RED, 100)]
    with_accent = [colour(RED, 80), colour(BLUE, 20)]
    assert palette_distance(plain, with_accent) > 0  # symmetric part catches the blue


def test_dominant_family_is_the_largest_colour() -> None:
    assert dominant_family([colour(RED, 70, "red"), colour(BLUE, 30, "blue")]) == "red"
    assert dominant_family([]) is None


# --- API helpers -------------------------------------------------------------------------------


def add(
    api: TestClient,
    rgb: tuple[int, int, int],
    accent: tuple[int, int, int] = (1, 2, 3),
    item_type: str = "garment",
) -> str:
    data = encode(blocks((300, 400), rgb, [((0, 380, 300, 400), accent)]))
    response = upload(api, data, item_type=item_type, content_type="image/png")
    assert response.status_code == 201, response.text
    return response.json()["id"]


def set_tags(api: TestClient, item_id: str, *pairs: tuple[str, str]) -> None:
    body = {"add": [{"category": c, "tag": t} for c, t in pairs]}
    assert api.patch(f"/items/{item_id}/tags", json=body).status_code == 200


def similar(api: TestClient, item_id: str, mode: str, **params: Any) -> Any:
    return api.get(f"/items/{item_id}/similar", params={"mode": mode, **params})


@pytest.fixture
def no_ai_tags(monkeypatch: pytest.MonkeyPatch) -> None:
    """Only explicit user tags exist, so mode filtering is fully controlled by the test."""
    monkeypatch.setattr(registry, "_tagger", None)


# --- palette mode -----------------------------------------------------------------------------


@pytest.mark.db
def test_palette_mode_ranks_by_colour_distance(api: TestClient, no_ai_tags: None) -> None:
    query = add(api, RED)
    near, middle, far = add(api, NEAR_RED), add(api, ORANGE), add(api, BLUE)

    body = similar(api, query, "palette").json()

    assert body["mode"] == "palette"
    assert [r["item"]["id"] for r in body["results"]] == [near, middle, far]
    distances = [r["palette_distance"] for r in body["results"]]
    assert distances == sorted(distances) and distances[0] > 0
    assert all(r["similarity"] is None for r in body["results"])
    assert body["results"][0]["reasons"][0].startswith("Colour distance")
    assert "not filtered by shape" in body["notice"]  # the query has no shape tags


@pytest.mark.db
def test_palette_mode_excludes_the_same_silhouette_only_when_known(
    api: TestClient, no_ai_tags: None
) -> None:
    query = add(api, RED)
    same_shape = add(api, NEAR_RED, (4, 5, 6))
    other_shape = add(api, NEAR_RED, (7, 8, 9))
    unknown_shape = add(api, NEAR_RED, (10, 11, 12))
    set_tags(api, query, ("silhouette", "fitted"))
    set_tags(api, same_shape, ("silhouette", "fitted"))
    set_tags(api, other_shape, ("silhouette", "flared"))

    results = {
        r["item"]["id"]: r["reasons"] for r in similar(api, query, "palette").json()["results"]
    }

    assert same_shape not in results
    assert any("Different silhouette: flared vs fitted" in r for r in results[other_shape])
    assert any("Shape unknown" in r for r in results[unknown_shape])


@pytest.mark.db
def test_palette_mode_works_without_the_image_model(
    api: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    settings = get_settings().model_copy(update={"model_cache_dir": tmp_path / "empty"})
    monkeypatch.setattr(registry, "get_settings", lambda: settings)
    registry.reset_for_tests()
    query, other = add(api, RED), add(api, BLUE)

    assert similar(api, query, "visual").status_code == 503
    body = similar(api, query, "palette").json()
    assert [r["item"]["id"] for r in body["results"]] == [other]


@pytest.mark.db
def test_palette_mode_needs_a_palette(api: TestClient, db: Session, owner: User) -> None:
    item = make_item(db, owner)
    response = similar(api, str(item.id), "palette")
    assert response.status_code == 422 and response.json()["error"]["code"] == "palette_missing"


# --- fabric mode ------------------------------------------------------------------------------


@pytest.mark.db
def test_fabric_mode_needs_shared_evidence_and_prefers_a_different_colour(
    api: TestClient, no_ai_tags: None
) -> None:
    query = add(api, RED)
    ikat_blue = add(api, BLUE)
    ikat_red = add(api, NEAR_RED)
    unrelated = add(api, ORANGE)
    set_tags(api, query, ("craft", "ikat"), ("fabric", "silk"))
    set_tags(api, ikat_blue, ("craft", "ikat"))
    set_tags(api, ikat_red, ("craft", "ikat"), ("fabric", "silk"))
    set_tags(api, unrelated, ("craft", "bandhani"))

    body = similar(api, query, "fabric").json()
    results = {r["item"]["id"]: r for r in body["results"]}

    assert body["mode"] == "fabric"
    assert unrelated not in results  # no shared fabric / pattern / craft tag
    assert [r["item"]["id"] for r in body["results"]] == [
        ikat_blue,
        ikat_red,
    ]  # different colour first
    assert "Shares craft: ikat" in results[ikat_blue]["reasons"]
    assert "Different dominant colour: blue vs red" in results[ikat_blue]["reasons"]
    assert "Shares fabric: silk" in results[ikat_red]["reasons"]
    assert "Same dominant colour family (red)" in results[ikat_red]["reasons"]
    assert all(r["similarity"] is not None for r in body["results"])


@pytest.mark.db
def test_fabric_mode_explains_when_the_item_has_no_evidence(
    api: TestClient, no_ai_tags: None
) -> None:
    query = add(api, RED)
    add(api, BLUE)
    body = similar(api, query, "fabric").json()
    assert body["results"] == []
    assert "no fabric, pattern or craft tag" in body["notice"]


@pytest.mark.db
def test_fabric_mode_waits_for_the_model_but_palette_mode_does_not(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    query = add(api, RED)
    add(api, BLUE)

    def loading() -> None:
        raise registry.EmbedderLoading(registry.LOADING_MESSAGE)

    monkeypatch.setattr(registry, "get_embedder_nowait", loading)
    response = similar(api, query, "fabric")
    assert response.status_code == 503 and response.json()["error"]["code"] == "model_loading"
    assert similar(api, query, "palette").status_code == 200


# --- ownership and modes ------------------------------------------------------------------------


@pytest.mark.db
def test_modes_never_return_other_users_items(
    api: TestClient, db: Session, stranger: User, fake_embedder: Any, no_ai_tags: None
) -> None:
    query = add(api, RED)
    mine = add(api, BLUE)
    set_tags(api, query, ("craft", "ikat"))
    set_tags(api, mine, ("craft", "ikat"))
    # A stranger's item that is a perfect match in every mode.
    theirs = make_item(db, stranger)
    query_palette = db.get(Palette, query)
    query_vector = db.get(Embedding, query)
    db.add(Palette(item_id=theirs.id, colors=query_palette.colors, source="original"))  # type: ignore[union-attr]
    db.add(
        Embedding(
            item_id=theirs.id,
            model_name=fake_embedder.model_name,
            vector=np.asarray(query_vector.vector),
        )
    )  # type: ignore[union-attr]
    db.flush()

    for mode in ("visual", "palette", "fabric"):
        ids = [r["item"]["id"] for r in similar(api, query, mode).json()["results"]]
        assert str(theirs.id) not in ids, mode
        assert ids == [mine], mode


@pytest.mark.db
def test_unknown_mode_is_rejected(api: TestClient) -> None:
    query = add(api, RED)
    assert similar(api, query, "texture").status_code == 422


@pytest.mark.db
def test_visual_mode_is_the_default_and_unchanged(api: TestClient) -> None:
    query, other = add(api, RED), add(api, BLUE)
    default = api.get(f"/items/{query}/similar").json()
    explicit = similar(api, query, "visual").json()
    assert default["mode"] == explicit["mode"] == "visual"
    assert [r["item"]["id"] for r in default["results"]] == [other]
    assert default["results"][0]["reasons"] == [] and default["notice"] is None
