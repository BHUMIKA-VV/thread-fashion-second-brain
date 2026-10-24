from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

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
    assert body["database"] == {
        "status": "unavailable",
        "server_version": None,
        "pgvector_available": None,
        "latency_ms": None,
    }
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
