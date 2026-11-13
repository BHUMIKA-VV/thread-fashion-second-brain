"""M14-1: the plan catalogue, served to the pricing page. Read-only; nothing can be bought."""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import app

DB = "postgresql+psycopg://unused/db"
MB = 1024**2


def settings(**overrides: Any) -> Settings:
    return Settings(_env_file=None, database_url=DB, **overrides)  # type: ignore[call-arg]


def catalogue(client: TestClient, **overrides: Any) -> dict[str, Any]:
    app.dependency_overrides[get_settings] = lambda: settings(**overrides)
    response = client.get("/billing/plans")
    assert response.status_code == 200, response.text
    return response.json()


def test_the_proposed_plans_with_server_defined_prices_in_paise(client: TestClient) -> None:
    body = catalogue(client)
    assert body["status"] == "proposed"
    assert body["on_sale"] is False
    fields = ("id", "price_paise", "currency", "period_days", "max_pieces", "max_bytes")
    rows = [tuple(p[f] for f in fields) for p in body["plans"]]
    assert rows == [
        ("free", 0, "INR", None, 25, None),
        ("studio", 99_900, "INR", 30, 100, 250 * MB),
        ("studio_pro", 249_900, "INR", 30, 250, 1024 * MB),
    ]


def test_each_plan_lists_known_features_and_includes_the_one_below(client: TestClient) -> None:
    body = catalogue(client)
    keys = [f["key"] for f in body["features"]]
    assert len(keys) == len(set(keys))
    assert all(f["label"] and f["detail"] for f in body["features"])
    free, studio, pro = (set(p["features"]) for p in body["plans"])
    assert free | studio | pro <= set(keys)
    assert free < studio <= pro
    assert {"demo", "playground", "archive"} <= free
    assert {"boards", "presentations", "outfit_studio"} <= studio - free


def test_nothing_is_offered_that_thread_does_not_do(client: TestClient) -> None:
    """No promise of support, unlimited use, or export counts the server can't keep."""
    body = catalogue(client)
    text = " ".join(
        [f"{f['label']} {f['detail']}" for f in body["features"]]
        + [p["summary"] for p in body["plans"]]
    ).lower()
    for claim in ("priority support", "unlimited", "advanced", "exports per", "ai-powered"):
        assert claim not in text


def test_prices_and_limits_come_from_settings(client: TestClient) -> None:
    body = catalogue(
        client,
        plan_studio_price_paise=120_000,
        plan_studio_pro_price_paise=300_000,
        plan_free_pieces=10,
        plan_period_days=31,
    )
    free, studio, pro = body["plans"]
    assert (free["max_pieces"], studio["price_paise"], pro["price_paise"]) == (10, 120_000, 300_000)
    assert studio["period_days"] == pro["period_days"] == 31


def test_anyone_can_read_it_and_it_may_be_cached_briefly(client: TestClient) -> None:
    app.dependency_overrides[get_settings] = lambda: settings()
    response = client.get("/billing/plans")  # no session cookie
    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=300"
    assert client.post("/billing/plans", json={"price_paise": 1}).status_code == 405


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"plan_free_pieces": 200}, "pieces must not shrink"),
        ({"plan_studio_pro_pieces": 50}, "pieces must not shrink"),
        ({"plan_studio_pro_bytes": 100 * MB}, "less storage"),
        ({"plan_studio_pro_price_paise": 99_900}, "must cost more"),
        ({"plan_studio_price_paise": 0}, "greater than 0"),
    ],
)
def test_settings_that_would_make_the_plans_inconsistent_are_refused(
    overrides: dict[str, int], message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        settings(**overrides)
