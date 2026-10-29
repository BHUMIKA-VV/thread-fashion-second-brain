"""Deep analysis API with a fake analyzer: no network, no API key (real Postgres)."""

import io
from contextlib import nullcontext
from datetime import timedelta
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import SecretStr
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.api.routes.deep_analysis import get_background_sessions, get_deep_analyzer
from app.core.config import Settings
from app.main import app
from app.ml.deep_analyzer import (
    MAX_LONG_EDGE,
    DeepAnalysisError,
    FakeDeepAnalyzer,
    build_analyzer,
    hint_text,
)
from app.models import DeepAnalysis, Item, User
from app.services.deep_analysis import STALE_AFTER, Claim, DeepAnalysisService, _finish
from tests.conftest import make_item, upload
from tests.images import blocks, encode

pytestmark = pytest.mark.db

NOTE_MARKER = "secret-note-7f3a"
URL_MARKER = "https://private.example/look-7f3a"


class ClaudeLikeFake(FakeDeepAnalyzer):
    """Behaves like the Claude analyzer for the guards (it counts toward the daily cap)."""

    provider = "claude"


@pytest.fixture
def fake() -> FakeDeepAnalyzer:
    return ClaudeLikeFake()


@pytest.fixture
def da(api: TestClient, db: Session, fake: FakeDeepAnalyzer) -> TestClient:
    """The API with the fake analyzer; background runs share the test session."""
    app.dependency_overrides[get_deep_analyzer] = lambda: fake
    app.dependency_overrides[get_background_sessions] = lambda: lambda: nullcontext(db)
    return api


def add_item(api: TestClient, seed: int = 0, size: tuple[int, int] = (300, 400)) -> str:
    image = blocks(size, (209, 41, 28), [((0, size[1] - 1, size[0], size[1]), (seed, 3, 7))])
    response = upload(api, encode(image), item_type="garment", content_type="image/png")
    assert response.status_code == 201, response.text
    return response.json()["id"]


def start(api: TestClient, item_id: str, **body: object) -> object:
    return api.post(f"/items/{item_id}/deep-analyze", json=body or {"confirm": True})


def analysis(api: TestClient, item_id: str) -> dict:
    response = api.get(f"/items/{item_id}/deep-analysis")
    assert response.status_code == 200, response.text
    return response.json()


# --- not configured -----------------------------------------------------------------------


def test_without_a_key_nothing_is_built_and_core_features_still_work(
    api: TestClient, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    def must_not_be_built(*_: object, **__: object) -> None:
        raise AssertionError("no Claude client may be built without a key")

    monkeypatch.setattr("app.ml.deep_analyzer.ClaudeDeepAnalyzer", must_not_be_built)
    assert settings.anthropic_api_key is None
    assert build_analyzer(settings) is None

    app.dependency_overrides.pop(get_deep_analyzer)  # the real dependency
    status = api.get("/deep-analysis/status").json()
    assert status["available"] is False and status["reason"] == "not_configured"
    assert status["provider"] is None and status["model"] is None
    assert "notes" in " ".join(status["not_sent"]).lower()

    item_id = add_item(api)  # uploads, palettes and tags are unaffected
    item = api.get(f"/items/{item_id}").json()
    assert item["palette"] is not None
    assert api.get(f"/items/{item_id}/tags").status_code == 200
    assert analysis(api, item_id)["status"] == "not_run"

    response = start(api, item_id)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "deep_analysis_unavailable"


def test_the_fake_provider_is_refused_in_production(settings: Settings) -> None:
    local = settings.model_copy(update={"deep_analysis_provider": "fake"})
    assert isinstance(build_analyzer(local), FakeDeepAnalyzer)
    production = local.model_copy(update={"app_env": "production"})
    assert build_analyzer(production) is None


def test_the_configured_model_is_used_without_substitution(settings: Settings) -> None:
    configured = settings.model_copy(
        update={
            "anthropic_api_key": SecretStr("sk-test-not-a-real-key"),
            "deep_analysis_model": "claude-x",
        }
    )
    analyzer = build_analyzer(configured)
    assert analyzer is not None and analyzer.provider == "claude" and analyzer.model == "claude-x"


# --- confirmation and the happy path --------------------------------------------------------


@pytest.mark.parametrize("body", [{}, {"confirm": False}, {"confirm": "yes"}, {"go": True}])
def test_a_run_needs_explicit_confirmation(da: TestClient, body: dict) -> None:
    item_id = add_item(da)
    response = da.post(f"/items/{item_id}/deep-analyze", json=body)
    assert response.status_code == 422


def test_a_run_completes_and_sends_only_the_image_palette_names_and_visible_tags(
    da: TestClient, db: Session, fake: FakeDeepAnalyzer
) -> None:
    item_id = add_item(da)
    da.patch(f"/items/{item_id}", json={"notes": NOTE_MARKER, "source_url": URL_MARKER})
    da.patch(
        f"/items/{item_id}/tags",
        json={"add": [{"category": "craft", "tag": "ikat"}], "remove": []},
    )
    before = db.get(Item, UUID(item_id))
    stages_before = dict(before.stage_status)
    status_before = before.processing_status

    response = start(da, item_id)
    assert response.status_code == 202
    assert response.json()["status"] == "running"  # the run happens after the response

    done = analysis(da, item_id)
    assert done["status"] == "completed" and done["error"] is None
    assert done["result_model"] == "local-fake-analyzer"
    assert done["result"]["summary"].startswith("Test description")
    assert done["usage"] == {"input_tokens": 0, "output_tokens": 0}

    sent = fake.calls[0]
    assert "sindoor red" in sent.colour_names
    assert ("craft", "ikat") in sent.tags
    text_sent = hint_text(sent.colour_names, sent.tags)
    assert NOTE_MARKER not in text_sent and URL_MARKER not in text_sent
    assert (
        NOTE_MARKER.encode() not in sent.image_jpeg and URL_MARKER.encode() not in sent.image_jpeg
    )
    assert sent.image_jpeg[:2] == b"\xff\xd8"  # JPEG

    db.expire_all()
    item = db.get(Item, UUID(item_id))
    assert item.ai_description == done["result"]["summary"]
    assert item.ai_description_model == "local-fake-analyzer"
    assert item.stage_status == stages_before and item.processing_status == status_before
    assert da.get("/deep-analysis/status").json()["runs_today"] == 1


def test_removed_tags_are_not_sent(da: TestClient, fake: FakeDeepAnalyzer) -> None:
    item_id = add_item(da)
    da.patch(f"/items/{item_id}/tags", json={"add": [{"category": "craft", "tag": "ikat"}]})
    da.patch(f"/items/{item_id}/tags", json={"remove": [{"category": "craft", "tag": "ikat"}]})
    start(da, item_id)
    assert ("craft", "ikat") not in fake.calls[0].tags


def test_large_images_are_resized_before_sending(da: TestClient, fake: FakeDeepAnalyzer) -> None:
    item_id = add_item(da, size=(3000, 4000))
    start(da, item_id)
    with Image.open(io.BytesIO(fake.calls[0].image_jpeg)) as sent:
        assert max(sent.size) == MAX_LONG_EDGE
        assert not sent.info.get("exif") and not sent.info.get("icc_profile")


# --- failures never corrupt anything ------------------------------------------------------


def test_a_failed_rerun_keeps_the_previous_result_and_item(
    da: TestClient, db: Session, fake: FakeDeepAnalyzer
) -> None:
    item_id = add_item(da)
    start(da, item_id)
    first = analysis(da, item_id)

    fake.error = DeepAnalysisError("rate_limited", "Try again in 30 seconds.", retry_after=30)
    assert start(da, item_id).status_code == 202
    failed = analysis(da, item_id)

    assert failed["status"] == "failed"
    assert failed["error"] == {
        "code": "rate_limited",
        "message": "Try again in 30 seconds.",
        "retry_after_seconds": 30,
    }
    assert failed["result"] == first["result"] and failed["result_at"] == first["result_at"]
    db.expire_all()
    assert db.get(Item, UUID(item_id)).ai_description == first["result"]["summary"]


def test_an_unexpected_analyzer_crash_is_recorded_not_raised(
    da: TestClient, fake: FakeDeepAnalyzer, monkeypatch: pytest.MonkeyPatch
) -> None:
    def crash(_: object) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr(fake, "analyze", crash)
    item_id = add_item(da)
    assert start(da, item_id).status_code == 202
    result = analysis(da, item_id)
    assert result["status"] == "failed" and result["error"]["code"] == "internal"
    assert "boom" not in result["error"]["message"]


def test_a_missing_image_file_fails_cleanly(da: TestClient, db: Session, storage: object) -> None:
    item_id = add_item(da)
    storage.delete(db.get(Item, UUID(item_id)).original_key)  # type: ignore[attr-defined]
    start(da, item_id)
    assert analysis(da, item_id)["error"]["code"] == "image_unreadable"


def test_a_stored_result_that_no_longer_fits_the_schema_is_hidden(
    da: TestClient, db: Session
) -> None:
    item_id = add_item(da)
    start(da, item_id)
    db.execute(update(DeepAnalysis).values(result={"summary": "old shape"}))
    db.flush()
    db.expire_all()
    shown = analysis(da, item_id)
    assert shown["status"] == "completed" and shown["result"] is None


# --- guards -------------------------------------------------------------------------------


def claim_without_running(db: Session, owner: User, settings: Settings, item_id: str) -> Claim:
    service = DeepAnalysisService(db, settings, owner.id, ClaudeLikeFake())
    return service.start(UUID(item_id))


def test_one_active_run_per_item(
    da: TestClient, db: Session, owner: User, settings: Settings
) -> None:
    item_id = add_item(da)
    claim_without_running(db, owner, settings, item_id)
    response = start(da, item_id)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "already_running"


def test_at_most_two_runs_at_once(
    da: TestClient, db: Session, owner: User, settings: Settings
) -> None:
    for seed in (1, 2):
        claim_without_running(db, owner, settings, add_item(da, seed=seed))
    response = start(da, add_item(da, seed=3))
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "busy"


def test_the_daily_cap_is_enforced_and_survives_deleting_pieces(
    da: TestClient, settings: Settings
) -> None:
    settings.deep_analysis_daily_limit = 2
    first, second = add_item(da, seed=1), add_item(da, seed=2)
    assert start(da, first).status_code == 202
    assert start(da, second).status_code == 202
    da.delete(f"/items/{first}")  # deleting a piece does not give runs back

    response = start(da, second)
    assert response.status_code == 429
    body = response.json()["error"]
    assert body["code"] == "daily_limit_reached" and "2" in body["message"]
    status = da.get("/deep-analysis/status").json()
    assert status["runs_today"] == 2 and status["daily_limit"] == 2


def test_a_daily_limit_of_zero_allows_no_runs(da: TestClient, settings: Settings) -> None:
    settings.deep_analysis_daily_limit = 0
    response = start(da, add_item(da))
    assert response.status_code == 429


def test_a_stale_run_is_reported_as_interrupted_and_can_be_retried(
    da: TestClient, db: Session, owner: User, settings: Settings
) -> None:
    item_id = add_item(da)
    claim_without_running(db, owner, settings, item_id)
    db.execute(
        update(DeepAnalysis).values(started_at=func.now() - STALE_AFTER - timedelta(minutes=1))
    )
    db.flush()
    db.expire_all()

    shown = analysis(da, item_id)
    assert shown["status"] == "failed" and shown["error"]["code"] == "interrupted"
    assert start(da, item_id).status_code == 202
    assert analysis(da, item_id)["status"] == "completed"


def test_a_superseded_run_cannot_overwrite_the_current_one(
    da: TestClient, db: Session, owner: User, settings: Settings
) -> None:
    item_id = add_item(da)
    old = claim_without_running(db, owner, settings, item_id)
    db.execute(
        update(DeepAnalysis).values(started_at=func.now() - STALE_AFTER - timedelta(minutes=1))
    )
    db.flush()
    current = claim_without_running(db, owner, settings, item_id)  # stale, so reclaimable

    late = _finish(db, old, result={"summary": "late"}, model="old")
    assert late is False
    row = db.scalar(select(DeepAnalysis))
    assert row.run_id == current.run_id and row.status == "running" and row.result is None


# --- ownership ------------------------------------------------------------------------------


def test_other_users_items_are_invisible(da: TestClient, db: Session, stranger: User) -> None:
    theirs = make_item(db, stranger)
    for response in (
        da.get(f"/items/{theirs.id}/deep-analysis"),
        start(da, str(theirs.id)),
    ):
        assert response.status_code == 404
    assert db.scalar(select(DeepAnalysis)) is None


def test_the_status_never_reveals_the_key_or_base_url(da: TestClient, settings: Settings) -> None:
    settings.anthropic_api_key = SecretStr("sk-test-not-a-real-key")
    body = da.get("/deep-analysis/status").text
    assert "sk-test" not in body and "anthropic.com" not in body


def test_local_fake_runs_do_not_use_up_the_daily_cap(
    da: TestClient, settings: Settings, fake: FakeDeepAnalyzer
) -> None:
    settings.deep_analysis_daily_limit = 1
    fake.provider = "fake"  # type: ignore[misc]  # the real local fake
    for seed in (1, 2, 3):
        assert start(da, add_item(da, seed=seed)).status_code == 202
    assert da.get("/deep-analysis/status").json()["runs_today"] == 0
