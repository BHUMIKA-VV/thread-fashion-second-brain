from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.db import migrations
from app.db.session import get_db
from app.main import app


class BrokenSession:
    """Stands in for a session whose database is down."""

    def execute(self, *_: object, **__: object) -> None:
        raise OperationalError("SELECT 1", {}, Exception("connection refused"))

    def close(self) -> None:
        pass


def test_health_reports_degraded_when_database_is_down(client: TestClient) -> None:
    def override() -> Iterator[BrokenSession]:
        yield BrokenSession()

    app.dependency_overrides[get_db] = override
    response = client.get("/health")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "degraded"
    assert body["database"]["status"] == "unavailable"
    assert body["database"]["server_version"] is None
    assert body["database"]["schema_up_to_date"] is None
    # Driver error text must not leak to clients.
    assert "connection refused" not in response.text


@pytest.mark.db
def test_health_ok_against_real_database(db_client: TestClient) -> None:
    response = db_client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"]["status"] == "ok"
    assert body["database"]["server_version"].startswith("16")
    assert body["database"]["schema_revision"] == migrations.head_revision()
    assert body["database"]["schema_up_to_date"] is True


@pytest.mark.db
def test_health_is_degraded_when_migrations_have_not_run(
    client: TestClient, empty_db_url: str
) -> None:
    engine = create_engine(empty_db_url)

    def override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_db] = override
    response = client.get("/health")
    engine.dispose()

    assert response.status_code == 503
    body = response.json()
    assert body["database"]["status"] == "ok"
    assert body["database"]["schema_revision"] is None
    assert body["database"]["schema_up_to_date"] is False
    assert body["database"]["pgvector_available"] is True


def test_unknown_route_returns_structured_error(client: TestClient) -> None:
    response = client.get("/does-not-exist")

    assert response.status_code == 404
    assert response.json() == {
        "error": {"code": "not_found", "message": "Not Found", "details": None}
    }


def test_openapi_schema_lists_health(client: TestClient) -> None:
    response = client.get("/openapi.json")

    assert response.status_code == 200
    assert "/health" in response.json()["paths"]
