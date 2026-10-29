"""Tags through the API: AI tags, corrections, re-analysis, scores, validation, ownership."""

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.ml import registry
from app.ml.tagging import Tagger
from app.models import Tag, User
from tests.conftest import make_item, upload
from tests.images import blocks, encode

pytestmark = pytest.mark.db


def add_item(
    api: TestClient, colour: tuple[int, int, int] = (200, 30, 40), **kwargs: Any
) -> dict[str, Any]:
    data = encode(blocks((300, 400), colour, [((0, 360, 300, 400), (1, 2, 3))]))
    response = upload(api, data, content_type="image/png", **kwargs)
    assert response.status_code == 201, response.text
    return response.json()


def tags(api: TestClient, item_id: str) -> dict[str, Any]:
    response = api.get(f"/items/{item_id}/tags")
    assert response.status_code == 200, response.text
    return response.json()


def edit(
    api: TestClient,
    item_id: str,
    add: list[tuple[str, str]] = (),
    remove: list[tuple[str, str]] = (),
) -> Any:  # type: ignore[assignment]
    body = {
        "add": [{"category": c, "tag": t} for c, t in add],
        "remove": [{"category": c, "tag": t} for c, t in remove],
    }
    return api.patch(f"/items/{item_id}/tags", json=body)


def shown(body: dict[str, Any]) -> set[tuple[str, str, str]]:
    return {(t["category"], t["tag"], t["source"]) for t in body["tags"]}


def tag_rows(db: Session, item_id: str, source: str | None = None) -> int:
    query = select(func.count()).select_from(Tag).where(Tag.item_id == item_id)
    if source:
        query = query.where(Tag.source == source)
    return db.scalar(query) or 0


def a_known_ai_tag(db: Session, item_id: str) -> tuple[str, str]:
    """Upload gave AI tags from the fake tagger; force one known AI tag for deterministic tests."""
    db.add(
        Tag(
            item_id=item_id,
            tag="ikat",
            category="craft",
            source="ai",
            confidence=0.8,
            model_name=registry.get_tagger_if_ready().version,
        )
    )  # type: ignore[union-attr]
    db.flush()
    return ("craft", "ikat")


# --- AI tags ---------------------------------------------------------------------------------


def test_upload_produces_ai_tags_with_the_current_version(api: TestClient, db: Session) -> None:
    item = add_item(api)
    body = tags(api, item["id"])

    assert item["stage_status"]["tags"] == "completed"
    assert body["status"] == "completed"
    assert body["tags"], "the fake tagger should produce some tags, or these tests prove nothing"
    assert body["version"] == registry.get_tagger_if_ready().version  # type: ignore[union-attr]
    assert all(t["source"] == "ai" and 0 <= t["score"] <= 1 for t in body["tags"])
    rows = db.scalars(select(Tag).where(Tag.item_id == item["id"])).all()
    assert {r.model_name for r in rows} <= {body["version"]}
    fabric = [t for t in body["tags"] if t["category"] == "fabric"]
    assert all(t["is_guess"] for t in fabric)


def test_stored_ai_tags_match_the_thresholded_scores(api: TestClient) -> None:
    item = add_item(api)
    body = tags(api, item["id"])
    scores = api.get(f"/items/{item['id']}/tag-scores").json()

    passing = {
        (c["category"], s["tag"]) for c in scores["categories"] for s in c["labels"] if s["passes"]
    }
    assert {(t["category"], t["tag"]) for t in body["tags"]} == passing
    assert "uncalibrated" in scores["note"]
    for category in scores["categories"]:
        assert sum(s["score"] for s in category["labels"]) == pytest.approx(1.0, abs=1e-3)


# --- corrections and re-analysis --------------------------------------------------------------


def test_corrections_are_separate_and_survive_reanalysis(api: TestClient, db: Session) -> None:
    item = add_item(api)
    ai_tag = a_known_ai_tag(db, item["id"])

    assert (
        edit(
            api,
            item["id"],
            add=[("craft", "bandhani"), ("aesthetic", "Quiet  Luxury ")],
            remove=[ai_tag],
        ).status_code
        == 200
    )
    body = tags(api, item["id"])
    assert ("craft", "bandhani", "user") in shown(body)
    assert ("aesthetic", "quiet luxury", "user") in shown(body)  # normalised
    assert ai_tag not in {(t["category"], t["tag"]) for t in body["tags"]}
    assert ai_tag in {(t["category"], t["tag"]) for t in body["removed"]}
    custom = {t["tag"]: t["custom"] for t in body["tags"] if t["source"] == "user"}
    assert custom == {"bandhani": False, "quiet luxury": True}

    for _ in range(2):  # re-analysis twice: idempotent
        assert api.post(f"/items/{item['id']}/reanalyze").status_code == 200
    after = tags(api, item["id"])
    assert {("craft", "bandhani", "user"), ("aesthetic", "quiet luxury", "user")} <= shown(after)
    assert tag_rows(db, item["id"], "user") == 3  # two additions + one removal, never duplicated
    ai_rows = db.scalars(select(Tag).where(Tag.item_id == item["id"], Tag.source == "ai")).all()
    assert len({(r.category, r.tag) for r in ai_rows}) == len(ai_rows)


def test_restoring_a_removed_ai_tag_and_undoing_an_addition(api: TestClient, db: Session) -> None:
    item = add_item(api)
    ai_tag = a_known_ai_tag(db, item["id"])
    edit(api, item["id"], remove=[ai_tag], add=[("pattern", "paisley")])

    assert edit(api, item["id"], add=[ai_tag], remove=[("pattern", "paisley")]).status_code == 200

    body = tags(api, item["id"])
    assert (*ai_tag, "ai") in shown(body) and body["removed"] == []
    assert ("pattern", "paisley", "user") not in shown(body)
    assert tag_rows(db, item["id"], "user") == 0


def test_adding_the_same_tag_twice_stores_it_once(api: TestClient, db: Session) -> None:
    item = add_item(api)
    edit(api, item["id"], add=[("occasion", "garden party")])
    edit(api, item["id"], add=[("occasion", "Garden Party")])
    assert tag_rows(db, item["id"], "user") == 1


def test_outdated_ai_tags_are_replaced(api: TestClient, db: Session) -> None:
    item = add_item(api)
    db.add(
        Tag(
            item_id=item["id"],
            tag="velvet",
            category="fabric",
            source="ai",
            confidence=0.9,
            model_name="older-model/pt0/vdeadbeef00",
        )
    )
    db.flush()

    tags(api, item["id"])  # GET notices the outdated row and re-tags from the stored vector

    versions = {
        r.model_name
        for r in db.scalars(select(Tag).where(Tag.item_id == item["id"], Tag.source == "ai")).all()
    }
    assert versions <= {registry.get_tagger_if_ready().version}  # type: ignore[union-attr]


# --- validation --------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"add": [{"category": "craft", "tag": "   "}]}, "invalid_tag"),
        ({"add": [{"category": "craft", "tag": "<script>"}]}, "invalid_tag"),
        ({"add": [{"category": "craft", "tag": "x" * 41}]}, "invalid_tag"),
        ({"add": [{"category": "craft", "tag": "none"}]}, "invalid_tag"),
        ({"add": [{"category": "craft", "tag": "-ikat"}]}, "invalid_tag"),
        ({"remove": [{"category": "craft", "tag": "not-on-item"}]}, "invalid_tag"),
        ({"add": [{"category": "mood", "tag": "calm"}]}, "validation_error"),
        ({"add": [{"category": "craft", "tag": "ikat", "extra": 1}]}, "validation_error"),
    ],
)
def test_invalid_edits_are_rejected(
    api: TestClient, db: Session, body: dict[str, Any], code: str
) -> None:
    item = add_item(api)
    before = tag_rows(db, item["id"], "user")
    response = api.patch(f"/items/{item['id']}/tags", json=body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == code
    assert tag_rows(db, item["id"], "user") == before


def test_user_tags_are_capped(api: TestClient) -> None:
    item = add_item(api)
    for start in (0, 20):
        assert (
            edit(
                api, item["id"], add=[("aesthetic", f"style {i}") for i in range(start, start + 20)]
            ).status_code
            == 200
        )
    response = edit(api, item["id"], add=[("aesthetic", "one too many")])
    assert response.status_code == 422 and "at most 40" in response.json()["error"]["message"]


# --- scores, vocabulary, model states ---------------------------------------------------------


def test_tag_scores_need_an_embedding_and_a_loaded_model(
    api: TestClient, db: Session, owner: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    unindexed = make_item(db, owner)
    response = api.get(f"/items/{unindexed.id}/tag-scores")
    assert response.status_code == 409 and response.json()["error"]["code"] == "not_indexed"

    def loading() -> None:
        raise registry.EmbedderLoading(registry.LOADING_MESSAGE)

    monkeypatch.setattr(registry, "get_embedder_nowait", loading)
    response = api.get(f"/items/{unindexed.id}/tag-scores")
    assert response.status_code == 503 and response.json()["error"]["code"] == "model_loading"


def test_fabric_items_get_no_garment_or_silhouette_scores(api: TestClient) -> None:
    item = add_item(api, item_type="fabric")
    categories = {
        c["category"] for c in api.get(f"/items/{item['id']}/tag-scores").json()["categories"]
    }
    assert "garment" not in categories and "silhouette" not in categories
    assert {"pattern", "fabric", "craft"} <= categories


def test_without_the_model_tags_are_unavailable_but_corrections_still_work(
    api: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    settings = get_settings().model_copy(update={"model_cache_dir": tmp_path / "empty"})
    monkeypatch.setattr(registry, "get_settings", lambda: settings)
    registry.reset_for_tests()

    item = add_item(api)
    body = tags(api, item["id"])

    assert item["stage_status"]["tags"] == "unavailable"
    assert body["status"] == "unavailable" and body["tags"] == []
    assert edit(api, item["id"], add=[("craft", "ajrakh")]).status_code == 200
    assert ("craft", "ajrakh", "user") in shown(tags(api, item["id"]))
    reanalysed = api.post(f"/items/{item['id']}/reanalyze")
    assert reanalysed.status_code == 200
    assert reanalysed.json()["stage_status"]["palette"] == "completed"
    assert reanalysed.json()["stage_status"]["tags"] == "unavailable"


def test_items_uploaded_while_the_model_loads_get_tags_once_it_is_ready(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Regression (found in live testing): such items have no embedding yet, so the tags view
    must index them itself once the model is ready, not stay "pending" forever."""
    embedder, tagger = registry._embedder, registry._tagger
    monkeypatch.setattr(registry, "_embedder", None)
    monkeypatch.setattr(registry, "_tagger", None)
    monkeypatch.setattr(registry, "status", lambda: {"weights_present": True, "state": "loading"})
    item = add_item(api)
    assert item["stage_status"]["embedding"] == item["stage_status"]["tags"] == "pending"
    assert tags(api, item["id"])["status"] == "pending"  # still loading: no waiting, no tags

    monkeypatch.setattr(registry, "_embedder", embedder)  # the model finished loading
    monkeypatch.setattr(registry, "_tagger", tagger)
    body = tags(api, item["id"])

    assert body["status"] == "completed" and body["tags"]
    detail = api.get(f"/items/{item['id']}").json()
    assert detail["stage_status"]["embedding"] == "completed"
    assert detail["processing_status"] == "completed"


def test_vocabulary_endpoint(api: TestClient) -> None:
    body = api.get("/tags/vocabulary").json()
    categories = {c["category"]: c for c in body["categories"]}
    assert "kanjeevaram" in categories["craft"]["tags"]
    assert "none" not in categories["craft"]["tags"]
    assert categories["fabric"]["is_guess"] is True


# --- ownership --------------------------------------------------------------------------------


def test_other_users_items_cannot_be_read_or_tagged(
    api: TestClient, db: Session, stranger: User
) -> None:
    foreign = make_item(db, stranger)
    for method, url, body in [
        ("GET", f"/items/{foreign.id}/tags", None),
        ("PATCH", f"/items/{foreign.id}/tags", {"add": [{"category": "craft", "tag": "ikat"}]}),
        ("GET", f"/items/{foreign.id}/tag-scores", None),
        ("POST", f"/items/{foreign.id}/reanalyze", None),
    ]:
        assert api.request(method, url, json=body).status_code == 404, (method, url)
    assert tag_rows(db, str(foreign.id)) == 0


def test_tagger_object_is_the_real_class(api: TestClient) -> None:
    assert isinstance(registry.get_tagger_if_ready(), Tagger)
