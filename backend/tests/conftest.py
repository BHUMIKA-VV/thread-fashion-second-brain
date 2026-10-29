"""Test fixtures.

Database tests never touch the development database. THREAD_TEST_DATABASE_URL points at a
maintenance database (thread_test) that is only used to CREATE and DROP disposable databases
with random names; each disposable database is migrated with the real Alembic migrations.
"""

import hashlib
import os
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

# This test process never loads the real image model at startup (set before the app imports;
# affects only this process, not the user's environment).
os.environ["THREAD_EMBEDDING_WARMUP"] = "false"
# Tests never see a real Anthropic key, even if one is in the repo .env (the environment
# wins over .env), and never pick the local fake provider by accident.
os.environ["THREAD_ANTHROPIC_API_KEY"] = ""
os.environ["THREAD_DEEP_ANALYSIS_PROVIDER"] = "claude"

import pytest  # noqa: E402
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, make_url, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_id, get_storage  # noqa: E402
from app.core.config import Settings, get_settings  # noqa: E402
from app.db import migrations  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.ml import registry  # noqa: E402
from app.models import Item, User  # noqa: E402
from app.storage import LocalStorage  # noqa: E402
from tests.fakes import FakeEmbedder, fake_tagger  # noqa: E402


@pytest.fixture(autouse=True)
def fake_embedder(request: pytest.FixtureRequest) -> Iterator[FakeEmbedder | None]:
    """Every test gets a fast, deterministic fake embedder unless marked `ml` (real model)."""
    registry.reset_for_tests()
    if request.node.get_closest_marker("ml"):
        yield None
    else:
        fake = FakeEmbedder()
        registry._embedder = fake  # loaded and ready, as after a warm-up
        registry._tagger = fake_tagger()
        registry._state = "ready"
        yield fake
    registry.reset_for_tests()


@pytest.fixture(autouse=True)
def no_deep_analyzer() -> Iterator[None]:
    """No test gets a deep analyzer (real or fake) unless it installs one itself."""
    from app.api.routes.deep_analysis import get_deep_analyzer

    app.dependency_overrides[get_deep_analyzer] = lambda: None
    yield
    app.dependency_overrides.pop(get_deep_analyzer, None)


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture(scope="session")
def maintenance_url() -> str:
    url = get_settings().test_database_url
    if not url:
        pytest.skip("THREAD_TEST_DATABASE_URL is not set")
    engine = create_engine(url, connect_args={"connect_timeout": 3})
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except OperationalError:
        pytest.skip("Test database is not reachable; run `docker compose up -d` first")
    finally:
        engine.dispose()
    return url


@contextmanager
def disposable_database(maintenance_url: str) -> Iterator[str]:
    """Create an empty database with a random name; drop it afterwards."""
    name = f"thread_t_{uuid.uuid4().hex[:12]}"
    admin = create_engine(maintenance_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    try:
        yield make_url(maintenance_url).set(database=name).render_as_string(hide_password=False)
    finally:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


@pytest.fixture
def empty_db_url(maintenance_url: str) -> Iterator[str]:
    with disposable_database(maintenance_url) as url:
        yield url


@pytest.fixture(scope="session")
def migrated_db_url(maintenance_url: str) -> Iterator[str]:
    """One disposable database per test session, migrated to head with Alembic."""
    with disposable_database(maintenance_url) as url:
        migrations.upgrade(url)
        yield url


@pytest.fixture
def db(migrated_db_url: str) -> Iterator[Session]:
    """A session whose work is rolled back after each test (savepoints allow inner rollbacks)."""
    engine = create_engine(migrated_db_url)
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()
        engine.dispose()


@pytest.fixture
def db_client(client: TestClient, db: Session) -> TestClient:
    app.dependency_overrides[get_db] = lambda: db
    return client


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
    """HTTP client acting as `owner`, on the test database and a temporary storage root."""
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


@pytest.fixture
def owner(db: Session) -> User:
    user = User(display_name="Owner")
    db.add(user)
    db.flush()
    return user


@pytest.fixture
def stranger(db: Session) -> User:
    user = User(display_name="Someone else")
    db.add(user)
    db.flush()
    return user


def item_fields(**overrides: Any) -> dict[str, Any]:
    """Valid column values for a new item; override what a test cares about."""
    seed = uuid.uuid4().hex
    fields: dict[str, Any] = {
        "original_key": f"users/test/items/{seed}/original.jpg",
        "content_hash": hashlib.sha256(seed.encode()).hexdigest(),
        "mime_type": "image/jpeg",
        "width": 800,
        "height": 1200,
        "file_size": 123_456,
    }
    fields.update(overrides)
    return fields


def make_item(db: Session, user: User, **overrides: Any) -> Item:
    item = Item(user_id=user.id, **item_fields(**overrides))
    db.add(item)
    db.flush()
    return item
