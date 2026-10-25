"""Palette extraction through the API: stored records, re-extraction, PNG card, failures."""

import io
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Item, Palette, User
from app.services import palettes as palette_service
from app.storage import LocalStorage
from tests.conftest import make_item
from tests.images import blocks, encode
from tests.test_items_api import api, settings, storage, upload  # noqa: F401  (fixtures)

pytestmark = pytest.mark.db

HALDI = (227, 160, 24)
INDIGO = (38, 59, 94)


def two_colour_png() -> bytes:
    return encode(blocks((500, 500), HALDI, [((0, 0, 500, 150), INDIGO)]))


def palette_count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(Palette)) or 0


def test_upload_extracts_and_stores_the_real_palette(api: TestClient, db: Session) -> None:  # noqa: F811
    response = upload(api, two_colour_png(), item_type="fabric", content_type="image/png")

    assert response.status_code == 201
    body = response.json()
    colors = body["palette"]["colors"]
    assert [(c["hex"], c["name"]) for c in colors] == [
        ("#e3a018", "haldi yellow"),
        ("#263b5e", "neel indigo"),
    ]
    assert [c["rgb"] for c in colors] == [list(HALDI), list(INDIGO)]
    assert [c["percentage"] for c in colors] == pytest.approx([70, 30], abs=1)
    assert sum(c["percentage"] for c in colors) == pytest.approx(100.0)
    assert body["palette"]["source"] == "original"  # fabric: no backdrop detection
    assert body["stage_status"]["palette"] == "completed"
    assert body["processing_error"] is None

    stored = db.get(Palette, body["id"])
    assert stored is not None
    assert [c["hex"] for c in stored.colors] == ["#e3a018", "#263b5e"]
    assert stored.color_families == ["blue", "orange"]
    assert stored.harmony == "complementary"  # hues 78° and 278°: 200° apart
    assert body["palette"]["harmony"] == "complementary"
    assert "lab" not in str(body["palette"])  # internal detail not exposed


def test_product_photo_backdrop_is_masked(api: TestClient) -> None:  # noqa: F811
    photo = encode(blocks((600, 800), (255, 255, 255), [((150, 150, 450, 650), (209, 41, 28))]))

    body = upload(api, photo, item_type="garment", content_type="image/png").json()

    assert body["palette"]["source"] == "masked"
    assert [(c["hex"], c["name"]) for c in body["palette"]["colors"]] == [
        ("#d1291c", "sindoor red")
    ]


def test_re_extraction_replaces_the_row(api: TestClient, db: Session) -> None:  # noqa: F811
    item = upload(
        api, encode(Image.effect_noise((300, 300), 80).convert("RGB")), content_type="image/png"
    ).json()
    assert palette_count(db) == 1

    response = api.post(f"/items/{item['id']}/palette", params={"colors": 2})

    assert response.status_code == 200
    assert len(response.json()["palette"]["colors"]) <= 2
    assert palette_count(db) == 1  # upserted, not duplicated
    assert api.post(f"/items/{item['id']}/palette", params={"colors": 0}).status_code == 422
    assert api.post(f"/items/{item['id']}/palette", params={"colors": 13}).status_code == 422


def test_palette_card_png(api: TestClient) -> None:  # noqa: F811
    item = upload(api, two_colour_png(), item_type="fabric", content_type="image/png").json()

    response = api.get(f"/items/{item['id']}/palette.png")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.headers["content-disposition"].startswith("attachment;")
    assert response.headers["x-content-type-options"] == "nosniff"
    card = Image.open(io.BytesIO(response.content))
    assert card.size == (1200, 675)
    assert card.getpixel((60, 60)) == HALDI


def test_no_palette_yet_means_404_for_the_card(api: TestClient, db: Session, owner: User) -> None:  # noqa: F811
    item = make_item(db, owner)
    response = api.get(f"/items/{item.id}/palette.png")
    assert response.status_code == 404
    assert response.json()["error"]["message"] == "This item has no palette yet."
    assert api.get(f"/items/{item.id}").json()["palette"] is None


# --- failures never produce a palette ----------------------------------------------------


def test_extraction_failure_on_upload_keeps_the_upload_and_records_the_error(
    api: TestClient,  # noqa: F811
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def boom(*_: Any, **__: Any) -> Any:
        raise RuntimeError("clustering exploded")

    monkeypatch.setattr(palette_service, "extract_palette", boom)

    response = upload(api, two_colour_png(), content_type="image/png")

    assert response.status_code == 201  # the image itself is safely stored
    body = response.json()
    assert body["palette"] is None and body["palette_card_url"] is None
    assert body["stage_status"]["palette"] == "failed"
    assert body["processing_error"] == "The colour palette could not be extracted from this image."
    assert "clustering exploded" not in response.text
    assert palette_count(db) == 0

    # Retrying after the problem is fixed clears the error.
    monkeypatch.undo()
    retried = api.post(f"/items/{body['id']}/palette")
    assert retried.status_code == 200
    assert retried.json()["stage_status"]["palette"] == "completed"
    assert retried.json()["processing_error"] is None


def test_unreadable_stored_file_fails_cleanly_and_keeps_the_earlier_palette(
    api: TestClient,  # noqa: F811
    db: Session,
    storage: LocalStorage,  # noqa: F811
) -> None:
    item = upload(api, two_colour_png(), content_type="image/png").json()
    row = db.get(Item, item["id"])
    assert row is not None
    path = storage.root / row.original_key
    path.write_bytes(b"corrupted on disk")

    response = api.post(f"/items/{item['id']}/palette")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "palette_failed"
    after = api.get(f"/items/{item['id']}").json()
    assert after["stage_status"]["palette"] == "failed"
    # The palette extracted earlier from the same image is not thrown away.
    assert [c["hex"] for c in after["palette"]["colors"]] == ["#e3a018", "#263b5e"]


def test_fully_transparent_image_gets_no_palette(api: TestClient, db: Session) -> None:  # noqa: F811
    transparent = encode(blocks((200, 200), (10, 20, 30, 0), mode="RGBA"))

    body = upload(api, transparent, content_type="image/png").json()

    assert body["palette"] is None
    assert body["stage_status"]["palette"] == "failed"
    assert palette_count(db) == 0


def test_palette_endpoints_respect_ownership(api: TestClient, db: Session, stranger: User) -> None:  # noqa: F811
    foreign = make_item(db, stranger)
    assert api.post(f"/items/{foreign.id}/palette").status_code == 404
    assert api.get(f"/items/{foreign.id}/palette.png").status_code == 404


def test_masked_source_is_allowed_by_the_schema(db: Session, owner: User) -> None:
    item = make_item(db, owner)
    db.add(Palette(item_id=item.id, colors=[], source="masked"))
    db.flush()  # would raise IntegrityError without the c3d1f2a7e9b4 migration
    assert db.get(Palette, item.id).source == "masked"  # type: ignore[union-attr]
