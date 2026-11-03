"""Anonymous visit counts: only a day, a page, a source category and a number are kept; opt-outs,
bots and floods aren't counted; only the owner reads the totals, beside a funnel built from the
app's own tables."""

from collections.abc import Iterator
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.main import app
from app.models import Interest, MetricCount, User
from app.services.auth import now
from app.services.metrics import host_of, source_for, today
from tests.conftest import as_user, make_item

BROWSER = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36"}


@pytest.mark.parametrize(
    ("referrer", "ref", "expected"),
    [
        (None, None, "direct"),
        ("", None, "direct"),
        ("https://l.instagram.com/?u=x", None, "instagram"),
        ("www.google.co.in", None, "search"),
        ("https://www.linkedin.com/feed/", None, "linkedin"),
        ("https://wa.me/123", None, "whatsapp"),
        ("https://t.co/abc", None, "x"),
        ("https://evilinstagram.com/", None, "other"),  # a lookalike is not Instagram
        ("http://127.0.0.1:3100/demo", None, "internal"),
        ("https://www.instagram.com/", "insta-nov", "ref:insta-nov"),  # a campaign tag wins
        ("https://www.instagram.com/", "Not A Slug!", "instagram"),  # an invalid tag is ignored
        ("https://www.instagram.com/", "x" * 33, "instagram"),
    ],
)
def test_sources_are_reduced_to_a_category(
    referrer: str | None, ref: str | None, expected: str
) -> None:
    assert source_for(referrer, ref, host_of("http://127.0.0.1:3100")) == expected


pytestmark_db = pytest.mark.db


@pytest.fixture
def visitor(db: Session) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client
    app.dependency_overrides.clear()


@pytest.fixture
def owner_api(db: Session, owner: User) -> Iterator[TestClient]:
    owner.is_owner = True
    db.flush()
    app.dependency_overrides.update({get_db: lambda: db, get_current_user: lambda: as_user(owner)})
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client
    app.dependency_overrides.clear()


def view(
    client: TestClient,
    event: str = "landing_view",
    headers: dict[str, str] | None = None,
    **body: object,
):  # noqa: ANN201
    return client.post("/metrics/view", json={"event": event, **body}, headers=headers or BROWSER)


def counts(db: Session) -> dict[tuple[str, str], int]:
    return {(r.event, r.source): r.count for r in db.scalars(select(MetricCount))}


@pytestmark_db
def test_a_view_adds_one_to_todays_count_for_its_page_and_source(
    visitor: TestClient, db: Session
) -> None:
    assert view(visitor).status_code == 204
    assert view(visitor).status_code == 204
    assert view(visitor, "demo_view", referrer="https://l.instagram.com/").status_code == 204
    assert counts(db) == {("landing_view", "direct"): 2, ("demo_view", "instagram"): 1}
    assert {r.day for r in db.scalars(select(MetricCount))} == {today()}


@pytestmark_db
def test_the_table_can_hold_nothing_personal(db: Session) -> None:
    columns = {c["name"] for c in inspect(db.connection()).get_columns("metric_counts")}
    assert columns == {"day", "event", "source", "count"}


@pytestmark_db
@pytest.mark.parametrize(
    "headers",
    [
        {**BROWSER, "Sec-GPC": "1"},
        {**BROWSER, "DNT": "1"},
        {"User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)"},
        {"User-Agent": "Mozilla/5.0 HeadlessChrome/130.0"},
        {"User-Agent": "facebookexternalhit/1.1"},
        {"User-Agent": ""},
    ],
)
def test_opt_outs_and_bots_get_the_same_answer_and_are_not_counted(
    visitor: TestClient, db: Session, headers: dict[str, str]
) -> None:
    assert view(visitor, headers=headers).status_code == 204
    assert counts(db) == {}


@pytestmark_db
@pytest.mark.parametrize(
    "body",
    [
        {"event": "checkout_view"},
        {"event": "landing_view", "email": "a@example.com"},
        {"event": "landing_view", "referrer": "x" * 256},
        {},
    ],
)
def test_only_known_pages_and_fields_are_accepted(
    visitor: TestClient, db: Session, body: dict[str, object]
) -> None:
    assert visitor.post("/metrics/view", json=body, headers=BROWSER).status_code == 422
    assert counts(db) == {}


@pytestmark_db
def test_a_flood_from_one_network_stops_counting_without_saying_so(
    visitor: TestClient, db: Session
) -> None:
    for _ in range(65):
        assert view(visitor).status_code == 204
    assert counts(db) == {("landing_view", "direct"): 60}


@pytestmark_db
def test_another_site_cannot_post_counts(visitor: TestClient, db: Session) -> None:
    response = view(visitor, headers={**BROWSER, "Origin": "https://evil.example"})
    assert response.status_code == 403
    assert counts(db) == {}


@pytestmark_db
def test_only_the_owner_reads_the_totals(visitor: TestClient, stranger: User) -> None:
    assert visitor.get("/admin/metrics").status_code == 401
    app.dependency_overrides[get_current_user] = lambda: as_user(stranger, owner=False)
    assert visitor.get("/admin/metrics").status_code == 403


@pytestmark_db
def test_the_owner_sees_totals_by_page_and_source_within_the_window(
    owner_api: TestClient, db: Session
) -> None:
    for _ in range(3):
        view(owner_api, "landing_view", referrer="https://www.instagram.com/")
    view(owner_api, "demo_view", referrer="https://www.instagram.com/")
    view(owner_api, "pilot_view", ref="flyer")
    db.add(
        MetricCount(
            day=today() - timedelta(days=40), event="landing_view", source="direct", count=9
        )
    )
    db.add(
        MetricCount(day=today() - timedelta(days=1), event="retired_view", source="direct", count=4)
    )
    db.flush()

    summary = owner_api.get("/admin/metrics", params={"days": 30}).json()
    assert summary["days"] == 30
    assert summary["events"] == {
        "landing_view": 3,
        "demo_view": 1,
        "how_it_works_view": 0,
        "pilot_view": 1,
        "signup_view": 0,
    }
    assert summary["sources"] == [
        {"source": "instagram", "total": 4, "events": {"landing_view": 3, "demo_view": 1}},
        {"source": "ref:flyer", "total": 1, "events": {"pilot_view": 1}},
    ]
    longer = owner_api.get("/admin/metrics", params={"days": 60}).json()
    assert longer["events"]["landing_view"] == 12
    for days in (0, 366):
        assert owner_api.get("/admin/metrics", params={"days": days}).status_code == 422


@pytestmark_db
def test_the_funnel_comes_from_the_apps_own_tables(
    owner_api: TestClient, db: Session, owner: User
) -> None:
    confirmed = User(display_name="Confirmed", email_verified_at=now())
    unconfirmed = User(display_name="Unconfirmed")
    old = User(display_name="Old", email_verified_at=now(), created_at=now() - timedelta(days=90))
    db.add_all([confirmed, unconfirmed, old])
    db.flush()
    make_item(db, confirmed)
    make_item(db, owner)  # the owner is never part of the funnel
    for email, kind, role in [
        ("w@example.com", "wardrobe", None),
        ("s@example.com", "studio", "stylist"),
        ("t@example.com", "studio", "designer"),
    ]:
        db.add(Interest(email=email, kind=kind, role=role, consented_at=now()))
    db.flush()

    funnel = owner_api.get("/admin/metrics").json()["funnel"]
    assert funnel == {
        "signups": 2,
        "confirmed": 1,
        "added_a_piece": 1,
        "wardrobe_interest": 1,
        "studio_interest": 2,
    }
