"""Upload, read, edit and delete items through the HTTP API (real DB, temp storage)."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_id, get_storage
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.main import app
from app.models import Item, User
from app.repositories.items import ItemRepository
from app.storage import LocalStorage
from app.storage.base import StorageError
from tests.conftest import make_item
from tests.images import image_bytes, open_image

pytestmark = pytest.mark.db


@pytest.fixture
def storage(tmp_path: Path) -> LocalStorage:
    return LocalStorage(tmp_path / "storage")


@pytest.fixture
def settings() -> Settings:
    return get_settings().model_copy(update={"max_upload_bytes": 2 * 1024 * 1024})


@pytest.fixture
def api(
    db: Session, owner: User, storage: LocalStorage, settings: Settings
) -> Iterator[TestClient]:
    app.dependency_overrides.update(
        {
            get_db: lambda: db,
            get_current_user_id: lambda: owner.id,
            get_storage: lambda: storage,
            get_settings: lambda: settings,
        }
    )
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client
    app.dependency_overrides.clear()


def upload(
    api: TestClient,
    data: bytes,
    item_type: str | None = "garment",
    name: str = "photo.jpg",
    content_type: str = "image/jpeg",
) -> Any:
    form = {"type": item_type} if item_type else {}
    return api.post("/items", files={"file": (name, data, content_type)}, data=form)


def stored_files(storage: LocalStorage) -> list[Path]:
    return (
        sorted(p for p in storage.root.rglob("*") if p.is_file()) if storage.root.exists() else []
    )


def item_count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(Item)) or 0


# --- upload ------------------------------------------------------------------------------


def test_upload_creates_record_and_files(
    api: TestClient, db: Session, owner: User, storage: LocalStorage
) -> None:
    response = upload(api, image_bytes("JPEG", (640, 480)))

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["type"] == "garment"
    assert body["processing_status"] == "queued"
    assert (body["width"], body["height"], body["mime_type"]) == (640, 480, "image/jpeg")
    assert body["image_url"] == f"/items/{body['id']}/image?variant=original"
    assert response.headers["location"] == f"/items/{body['id']}"
    # Internal details never leak.
    for secret in ("original_key", "thumbnail_key", "content_hash", "user_id", "users/"):
        assert secret not in response.text

    item = db.get(Item, body["id"])
    assert item is not None and item.user_id == owner.id
    assert item.original_key == f"users/{owner.id}/items/{item.id}/original.jpg"
    assert storage.exists(item.original_key) and storage.exists(item.thumbnail_key)
    assert item.stage_status == {"thumbnail": "completed", "palette": "completed"}
    assert body["palette"]["colors"] and body["palette_card_url"] == f"/items/{item.id}/palette.png"


def test_user_filename_and_content_type_are_ignored(
    api: TestClient, db: Session, storage: LocalStorage
) -> None:
    response = upload(
        api, image_bytes("PNG"), name="../../evil.exe", content_type="application/x-msdownload"
    )

    assert response.status_code == 201
    assert response.json()["mime_type"] == "image/png"
    names = [p.name for p in stored_files(storage)]
    assert sorted(names) == ["original.png", "thumbnail.webp"]


def test_type_defaults_to_other_and_rejects_unknown(api: TestClient) -> None:
    assert upload(api, image_bytes(), item_type=None).json()["type"] == "other"
    assert upload(api, image_bytes(), item_type="shoe").status_code == 422


@pytest.mark.parametrize(
    ("data", "status", "code"),
    [
        (b"definitely not an image", 422, "invalid_image"),
        (image_bytes("GIF", mode="P"), 415, "unsupported_format"),
        (image_bytes("PNG", (40, 40)), 422, "bad_dimensions"),
    ],
)
def test_rejected_uploads_leave_nothing_behind(
    api: TestClient, db: Session, storage: LocalStorage, data: bytes, status: int, code: str
) -> None:
    response = upload(api, data)

    assert response.status_code == status
    assert response.json()["error"]["code"] == code
    assert item_count(db) == 0
    assert stored_files(storage) == []


def test_oversized_upload_is_rejected(api: TestClient, db: Session, storage: LocalStorage) -> None:
    big = b"\xff\xd8\xff" + b"\x00" * (2 * 1024 * 1024 + 10)

    response = upload(api, big)

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "too_large"
    assert item_count(db) == 0 and stored_files(storage) == []


def test_duplicate_upload_returns_existing_item(
    api: TestClient, db: Session, storage: LocalStorage
) -> None:
    data = image_bytes("WEBP")
    first = upload(api, data).json()

    response = upload(api, data)

    assert response.status_code == 409
    assert response.json()["error"]["details"] == {"existing_item_id": first["id"]}
    assert item_count(db) == 1
    assert len(stored_files(storage)) == 2


def test_missing_file_field_is_a_validation_error(api: TestClient) -> None:
    response = api.post("/items", data={"type": "fabric"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


# --- consistency when a step fails -------------------------------------------------------


def test_database_failure_removes_written_files(
    api: TestClient, db: Session, storage: LocalStorage, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken_create(self: ItemRepository, **_: Any) -> Item:
        raise RuntimeError("database went away")

    monkeypatch.setattr(ItemRepository, "create", broken_create)

    response = upload(api, image_bytes())

    assert response.status_code == 500
    assert "database went away" not in response.text
    assert stored_files(storage) == []
    assert item_count(db) == 0


def test_storage_failure_removes_partial_files(
    api: TestClient, db: Session, storage: LocalStorage, monkeypatch: pytest.MonkeyPatch
) -> None:
    real_save = LocalStorage.save

    def fail_on_thumbnail(self: LocalStorage, key: str, data: bytes) -> None:
        if key.endswith("thumbnail.webp"):
            raise StorageError("disk full")
        real_save(self, key, data)

    monkeypatch.setattr(LocalStorage, "save", fail_on_thumbnail)

    response = upload(api, image_bytes())

    assert response.status_code == 500
    assert stored_files(storage) == []  # the original written first was removed again
    assert item_count(db) == 0


# --- read, list, edit, delete -----------------------------------------------------------


def test_list_and_filter_by_type(api: TestClient) -> None:
    upload(api, image_bytes(), item_type="fabric")
    upload(api, image_bytes(), item_type="outfit")
    upload(api, image_bytes(), item_type="fabric")

    everything = api.get("/items").json()
    fabrics = api.get("/items", params={"type": "fabric"}).json()
    page = api.get("/items", params={"limit": 1, "offset": 1}).json()

    assert everything["total"] == 3 and len(everything["items"]) == 3
    assert fabrics["total"] == 2 and {i["type"] for i in fabrics["items"]} == {"fabric"}
    assert page["total"] == 3 and len(page["items"]) == 1
    assert page["items"][0]["id"] == everything["items"][1]["id"]
    assert api.get("/items", params={"limit": 0}).status_code == 422


def test_image_variants_are_served_with_safe_headers(api: TestClient) -> None:
    item = upload(api, image_bytes("PNG", (1000, 600))).json()

    original = api.get(f"/items/{item['id']}/image", params={"variant": "original"})
    thumbnail = api.get(f"/items/{item['id']}/image", params={"variant": "thumbnail"})

    assert original.status_code == 200 and original.headers["content-type"] == "image/png"
    assert open_image(original.content).size == (1000, 600)
    assert thumbnail.headers["content-type"] == "image/webp"
    assert open_image(thumbnail.content).size == (640, 384)  # longest side = thumbnail_side
    for response in (original, thumbnail):
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["cache-control"].startswith("private")


@pytest.mark.parametrize(
    "path",
    [
        "/items/{id}/image?variant=../../.env",
        "/items/{id}/image?variant=original.jpg",
        "/items/..%2F..%2F.env/image",
        "/items/{id}/../../.env",
        "/storage/users",
    ],
)
def test_files_cannot_be_reached_by_arbitrary_paths(api: TestClient, path: str) -> None:
    item = upload(api, image_bytes()).json()

    response = api.get(path.format(id=item["id"]))

    assert response.status_code in (404, 422)
    assert response.headers["content-type"].startswith("application/json")


def test_patch_updates_editable_fields(api: TestClient) -> None:
    item = upload(api, image_bytes()).json()

    response = api.patch(
        f"/items/{item['id']}",
        json={"type": "fabric", "notes": "Chanderi sample", "source_url": "https://example.test/x"},
    )

    assert response.status_code == 200
    body = response.json()
    assert (body["type"], body["notes"], body["source_url"]) == (
        "fabric",
        "Chanderi sample",
        "https://example.test/x",
    )
    cleared = api.patch(f"/items/{item['id']}", json={"notes": None, "source_url": None}).json()
    assert (
        cleared["notes"] is None and cleared["source_url"] is None and cleared["type"] == "fabric"
    )


@pytest.mark.parametrize(
    "body",
    [
        {"source_url": "javascript:alert(1)"},
        {"source_url": "file:///etc/passwd"},
        {"source_url": "not a url"},
        {"type": "shoe"},
        {"notes": "x" * 5001},
        {"processing_status": "completed"},
    ],
)
def test_patch_rejects_invalid_or_system_fields(api: TestClient, body: dict[str, Any]) -> None:
    item = upload(api, image_bytes()).json()
    assert api.patch(f"/items/{item['id']}", json=body).status_code == 422


def test_delete_removes_record_and_files(
    api: TestClient, db: Session, storage: LocalStorage
) -> None:
    item = upload(api, image_bytes()).json()
    assert len(stored_files(storage)) == 2

    assert api.delete(f"/items/{item['id']}").status_code == 204

    assert api.get(f"/items/{item['id']}").status_code == 404
    assert api.get(f"/items/{item['id']}/image").status_code == 404
    assert stored_files(storage) == []
    assert api.delete(f"/items/{item['id']}").status_code == 404


# --- ownership ---------------------------------------------------------------------------


def test_other_users_items_are_invisible(api: TestClient, db: Session, stranger: User) -> None:
    foreign = make_item(db, stranger)
    upload(api, image_bytes())

    listing = api.get("/items").json()
    assert listing["total"] == 1
    assert str(foreign.id) not in {i["id"] for i in listing["items"]}
    for method, url in [
        ("GET", f"/items/{foreign.id}"),
        ("GET", f"/items/{foreign.id}/image"),
        ("GET", f"/items/{foreign.id}/image?variant=original"),
        ("PATCH", f"/items/{foreign.id}"),
        ("DELETE", f"/items/{foreign.id}"),
    ]:
        response = api.request(method, url, json={"notes": "mine"} if method == "PATCH" else None)
        assert response.status_code == 404, (method, url)
    assert db.get(Item, foreign.id) is not None


def test_same_image_may_belong_to_two_users(
    api: TestClient, db: Session, owner: User, stranger: User
) -> None:
    data = image_bytes()
    upload(api, data)

    app.dependency_overrides[get_current_user_id] = lambda: stranger.id
    response = upload(api, data)

    assert response.status_code == 201
    assert item_count(db) == 2
