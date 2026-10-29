"""Requests that index or tag an item while another request deletes it answer 404, not 500.

The usual `db` fixture runs a whole test in one rolled-back transaction, which cannot show
this race: a rollback inside the request would undo the "concurrent" delete too. These tests
use committed data instead. Each request gets its own session, and a separate autocommit
connection deletes the item at the moment the race happens in real use.
"""

import io
import uuid
from collections.abc import Callable, Iterator
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import Connection, create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user, get_storage
from app.core.config import get_settings
from app.db.session import get_db
from app.main import app
from app.models import Embedding, Item, User
from app.services import tags as tags_module
from app.services.auth import Principal
from app.services.vanished import ItemDeleted, unless_deleted
from app.storage import LocalStorage
from tests.conftest import make_item

pytestmark = pytest.mark.db


class RacingStorage(LocalStorage):
    """Local storage whose next read of `target` first lets `on_read` run (the other request)."""

    target: str | None = None
    on_read: Callable[[], None] | None = None

    def read(self, key: str) -> bytes:
        if key == self.target and self.on_read is not None:
            hook, self.on_read = self.on_read, None
            hook()
        return super().read(key)


@pytest.fixture
def committed(
    migrated_db_url: str, tmp_path: Path
) -> Iterator[tuple[TestClient, Connection, RacingStorage]]:
    engine = create_engine(migrated_db_url)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)  # as in production
    other = engine.connect().execution_options(isolation_level="AUTOCOMMIT")
    storage = RacingStorage(tmp_path / "storage")
    with sessions() as setup:
        user = User(display_name="Racer")
        setup.add(user)
        setup.commit()
        owner_id = user.id

    def request_session() -> Iterator[Session]:
        with sessions() as session:
            yield session

    app.dependency_overrides.update(
        {
            get_db: request_session,
            get_current_user: lambda: Principal(owner_id, is_owner=True, email_verified=True),
            get_storage: lambda: storage,
            get_settings: lambda: get_settings(),
        }
    )
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            yield client, other, storage
    finally:
        app.dependency_overrides.clear()
        other.execute(text("DELETE FROM users WHERE id = :id"), {"id": owner_id})  # cascades
        other.close()
        engine.dispose()


def png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 96), tuple(int(v) for v in np.random.randint(0, 256, 3))).save(buf, "PNG")
    return buf.getvalue()


def unindexed_item(client: TestClient, other: Connection) -> dict[str, str]:
    """An uploaded item whose embedding is gone, so GET /tags has to index it again."""
    response = client.post(
        "/items", files={"file": ("x.png", png(), "image/png")}, data={"type": "fabric"}
    )
    assert response.status_code == 201
    item = response.json()
    other.execute(text("DELETE FROM embeddings WHERE item_id = :id"), {"id": item["id"]})
    key = other.execute(
        text("SELECT original_key FROM items WHERE id = :id"), {"id": item["id"]}
    ).scalar_one()
    return {"id": item["id"], "key": key}


def delete_row(other: Connection, item_id: str) -> Callable[[], None]:
    return lambda: other.execute(text("DELETE FROM items WHERE id = :id"), {"id": item_id})


def test_deleted_while_reading_its_file_is_404(
    committed: tuple[TestClient, Connection, RacingStorage],
) -> None:
    client, other, storage = committed
    item = unindexed_item(client, other)

    def delete_item_and_file() -> None:  # what DELETE /items/{id} does: row, then files
        delete_row(other, item["id"])()
        storage.delete(item["key"])

    storage.target, storage.on_read = item["key"], delete_item_and_file
    response = client.get(f"/items/{item['id']}/tags")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
    assert not storage.exists(item["key"])  # the read really failed: the file was gone


def test_deleted_before_its_embedding_is_saved_is_404(
    committed: tuple[TestClient, Connection, RacingStorage],
) -> None:
    client, other, storage = committed
    item = unindexed_item(client, other)
    # The file is still readable (deletion removes files after the row), so embedding succeeds
    # and the insert of the new vector then hits the foreign key.
    storage.target, storage.on_read = item["key"], delete_row(other, item["id"])

    response = client.get(f"/items/{item['id']}/tags")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_deleted_before_its_tags_are_saved_is_404(
    committed: tuple[TestClient, Connection, RacingStorage], monkeypatch: pytest.MonkeyPatch
) -> None:
    client, other, _ = committed
    response = client.post(
        "/items", files={"file": ("x.png", png(), "image/png")}, data={"type": "fabric"}
    )
    item_id = response.json()["id"]
    # Embedding is current but tags are outdated, so GET /tags re-tags from the stored vector.
    other.execute(
        text("UPDATE items SET stage_status = stage_status - 'tags' WHERE id = :id"),
        {"id": item_id},
    )
    original = tags_module.TagService.apply_ai_tags

    def racing_apply(self: tags_module.TagService, *args: object, **kwargs: object) -> None:
        delete_row(other, item_id)()
        original(self, *args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(tags_module.TagService, "apply_ai_tags", racing_apply)

    response = client.get(f"/items/{item_id}/tags")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_other_integrity_errors_are_not_disguised_as_404(db: Session, owner: User) -> None:
    item = make_item(db, owner)
    db.commit()  # keep it through the rollback below (releases this test's savepoint)
    with pytest.raises(IntegrityError), unless_deleted(db, item.id):
        # A real bug (an embedding for an item that never existed) while `item` still exists.
        db.add(Embedding(item_id=uuid.uuid4(), model_name="m", vector=[0.0] * 512))
        db.flush()
    assert db.get(Item, item.id) is not None


def test_a_missing_item_becomes_item_deleted(db: Session) -> None:
    missing = uuid.uuid4()
    with pytest.raises(ItemDeleted), unless_deleted(db, missing):
        db.add(Embedding(item_id=missing, model_name="m", vector=[0.0] * 512))
        db.flush()


@pytest.mark.parametrize("mode", ["visual", "fabric"])
def test_similar_for_a_piece_deleted_during_the_backfill_is_404(
    committed: tuple[TestClient, Connection, RacingStorage], mode: str
) -> None:
    client, other, storage = committed
    # Both pieces need indexing (as when they were uploaded while the model was loading): the
    # request indexes the query piece, then backfills the neighbour, during which another
    # request deletes the query piece.
    query = unindexed_item(client, other)
    query_id, query_key = query["id"], query["key"]
    neighbour = unindexed_item(client, other)

    def delete_query_piece() -> None:  # another request deletes the piece being compared
        delete_row(other, query_id)()
        storage.delete(query_key)

    storage.target, storage.on_read = neighbour["key"], delete_query_piece
    response = client.get(f"/items/{query_id}/similar", params={"mode": mode})

    assert storage.on_read is None  # the race really happened during the request
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
