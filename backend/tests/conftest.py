from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.db.session import get_db
from app.main import app


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture(scope="session")
def test_session_factory() -> sessionmaker[Session]:
    """Session factory bound to the dedicated test database (never the dev database)."""
    url = get_settings().test_database_url
    if not url:
        pytest.skip("THREAD_TEST_DATABASE_URL is not set")
    engine = create_engine(url, connect_args={"connect_timeout": 3})
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except OperationalError:
        pytest.skip("Test database is not reachable; run `docker compose up -d` first")
    return sessionmaker(bind=engine)


@pytest.fixture
def db_client(client: TestClient, test_session_factory: sessionmaker[Session]) -> TestClient:
    def override() -> Iterator[Session]:
        session = test_session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override
    return client
