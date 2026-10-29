"""Deleting a piece while its deep analysis runs (committed data and real sessions, because a
rolled-back test transaction cannot show a delete from another connection)."""

import hashlib
import io
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from PIL import Image
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.ml.deep_analyzer import AnalysisInput, AnalysisOutput, FakeDeepAnalyzer
from app.models import DeepAnalysis, Item, User
from app.services.deep_analysis import Claim, DeepAnalysisService, run_deep_analysis
from app.storage import LocalStorage, item_key

pytestmark = pytest.mark.db


@pytest.fixture
def world(
    migrated_db_url: str, tmp_path: Path
) -> Iterator[tuple[sessionmaker[Session], LocalStorage, User]]:
    engine = create_engine(migrated_db_url)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    storage = LocalStorage(tmp_path / "storage")
    with sessions() as db:
        user = User(display_name="Racer")
        db.add(user)
        db.commit()
    try:
        yield sessions, storage, user
    finally:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM users WHERE id = :id"), {"id": user.id})
        engine.dispose()


def stored_item(sessions: sessionmaker[Session], storage: LocalStorage, user: User) -> Item:
    item_id = uuid.uuid4()
    key = item_key(user.id, item_id, "original.png")
    buffer = io.BytesIO()
    Image.new("RGB", (80, 120), (200, 30, 40)).save(buffer, "PNG")
    storage.save(key, buffer.getvalue())
    with sessions() as db:
        item = Item(
            id=item_id,
            user_id=user.id,
            original_key=key,
            content_hash=hashlib.sha256(item_id.bytes).hexdigest(),
            mime_type="image/png",
            width=80,
            height=120,
            file_size=buffer.tell(),
        )
        db.add(item)
        db.commit()
        return item


def claim(sessions: sessionmaker[Session], user: User, item: Item) -> Claim:
    with sessions() as db:
        return DeepAnalysisService(db, get_settings(), user.id, FakeDeepAnalyzer()).start(item.id)


def delete_item(sessions: sessionmaker[Session], storage: LocalStorage, item: Item) -> None:
    with sessions() as db:  # what DELETE /items/{id} does: the row (cascades), then the files
        db.execute(text("DELETE FROM items WHERE id = :id"), {"id": item.id})
        db.commit()
    storage.delete(item.original_key)


class DeletingAnalyzer(FakeDeepAnalyzer):
    """Deletes the item while "Claude" is thinking, then answers normally."""

    def __init__(self, on_analyze: object) -> None:
        super().__init__()
        self.on_analyze = on_analyze

    def analyze(self, data: AnalysisInput) -> AnalysisOutput:
        self.on_analyze()  # type: ignore[operator]
        return super().analyze(data)


def test_deleting_the_piece_while_claude_answers_discards_the_outcome_quietly(
    world: tuple[sessionmaker[Session], LocalStorage, User],
    caplog: pytest.LogCaptureFixture,
) -> None:
    sessions, storage, user = world
    item = stored_item(sessions, storage, user)
    run = claim(sessions, user, item)
    analyzer = DeletingAnalyzer(lambda: delete_item(sessions, storage, item))

    run_deep_analysis(sessions, storage, get_settings(), analyzer, run)  # must not raise

    assert len(analyzer.calls) == 1
    with sessions() as db:
        assert db.get(Item, item.id) is None
        assert db.scalar(select(func.count()).select_from(DeepAnalysis)) == 0
    assert "outcome discarded" in caplog.text
    assert "Traceback" not in caplog.text


def test_deleting_the_piece_before_the_run_reads_it_sends_nothing(
    world: tuple[sessionmaker[Session], LocalStorage, User],
) -> None:
    sessions, storage, user = world
    item = stored_item(sessions, storage, user)
    run = claim(sessions, user, item)
    delete_item(sessions, storage, item)
    analyzer = FakeDeepAnalyzer()

    run_deep_analysis(sessions, storage, get_settings(), analyzer, run)

    assert analyzer.calls == []  # nothing was sent anywhere
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(DeepAnalysis)) == 0


def test_other_pieces_are_untouched_by_a_run(
    world: tuple[sessionmaker[Session], LocalStorage, User],
) -> None:
    sessions, storage, user = world
    target, bystander = (stored_item(sessions, storage, user) for _ in range(2))
    with sessions() as db:
        before = db.execute(
            text("SELECT ai_description, stage_status, updated_at FROM items WHERE id = :id"),
            {"id": bystander.id},
        ).one()

    run_deep_analysis(
        sessions, storage, get_settings(), FakeDeepAnalyzer(), claim(sessions, user, target)
    )

    with sessions() as db:
        after = db.execute(
            text("SELECT ai_description, stage_status, updated_at FROM items WHERE id = :id"),
            {"id": bystander.id},
        ).one()
        assert after == before
        assert db.get(DeepAnalysis, target.id).status == "completed"
