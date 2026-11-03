"""Interest from the public site: kept only with consent, one row per address and kind, the
same answer for new and known addresses, rate-limited, and visible only to the owner."""

from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.main import app
from app.models import Interest, User
from app.services.auth import now
from tests.conftest import as_user

pytestmark = pytest.mark.db


@pytest.fixture
def visitor(db: Session) -> Iterator[TestClient]:
    """A signed-out browser on the test database."""
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


def studio(**overrides: Any) -> dict[str, Any]:
    body = {
        "kind": "studio",
        "role": "boutique",
        "name": "Asha",
        "email": "Asha@Example.com ",
        "message": "Saree boutique, about 300 pieces.",
        "consent": True,
    }
    return {**body, **overrides}


def rows(db: Session) -> list[Interest]:
    return list(db.scalars(select(Interest).order_by(Interest.created_at)))


def test_a_studio_registration_is_kept_with_its_consent_moment(
    visitor: TestClient, db: Session
) -> None:
    response = visitor.post("/interest", json=studio())
    assert response.status_code == 202, response.text
    assert response.json() == {"status": "received"}
    [row] = rows(db)
    assert (row.kind, row.role, row.name, row.email) == (
        "studio",
        "boutique",
        "Asha",
        "asha@example.com",
    )
    assert row.message == "Saree boutique, about 300 pieces."
    assert row.consented_at is not None and row.contacted_at is None


def test_registering_again_updates_the_same_row_and_answers_the_same_way(
    visitor: TestClient, db: Session
) -> None:
    first = visitor.post("/interest", json=studio())
    again = visitor.post(
        "/interest", json=studio(email="asha@example.com", role="designer", message="Now a label.")
    )
    assert (first.status_code, first.json()) == (again.status_code, again.json())
    [row] = rows(db)
    assert (row.role, row.message) == ("designer", "Now a label.")
    # The same address can also want a wardrobe: a separate row of the other kind.
    assert (
        visitor.post(
            "/interest", json={"kind": "wardrobe", "email": "asha@example.com", "consent": True}
        ).status_code
        == 202
    )
    assert sorted(r.kind for r in rows(db)) == ["studio", "wardrobe"]


@pytest.mark.parametrize(
    "body",
    [
        studio(consent=False),
        {k: v for k, v in studio().items() if k != "consent"},
        studio(role=None),
        studio(role="influencer"),
        studio(kind="investor"),
        studio(email="not-an-address"),
        studio(message="x" * 1001),
        studio(name="n" * 121),
        studio(phone="+91 98765 43210"),  # nothing beyond the form's own fields
    ],
)
def test_invalid_or_unconsented_registrations_are_refused_and_nothing_is_kept(
    visitor: TestClient, db: Session, body: dict[str, Any]
) -> None:
    response = visitor.post("/interest", json=body)
    assert response.status_code == 422, response.text
    assert rows(db) == []


def test_wardrobe_interest_needs_no_role_and_keeps_none(visitor: TestClient, db: Session) -> None:
    body = {"kind": "wardrobe", "role": "stylist", "email": "a@example.com", "consent": True}
    assert visitor.post("/interest", json=body).status_code == 202
    [row] = rows(db)
    assert (row.kind, row.role, row.name, row.message) == ("wardrobe", None, None, None)


def test_the_hidden_field_marks_a_bot_which_gets_the_usual_answer_and_nothing_kept(
    visitor: TestClient, db: Session
) -> None:
    response = visitor.post("/interest", json=studio(website="https://spam.example"))
    assert (response.status_code, response.json()) == (202, {"status": "received"})
    assert rows(db) == []


def test_registrations_are_rate_limited_per_address_and_per_network(
    visitor: TestClient, db: Session
) -> None:
    for _ in range(3):
        assert visitor.post("/interest", json=studio()).status_code == 202
    limited = visitor.post("/interest", json=studio())
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "rate_limited"
    assert "retry-after" in limited.headers
    # The refused attempt still counted for this network: one more address reaches its
    # limit of five an hour, and the next is refused.
    assert visitor.post("/interest", json=studio(email="p1@example.com")).status_code == 202
    assert visitor.post("/interest", json=studio(email="p2@example.com")).status_code == 429
    assert len(rows(db)) == 2


def test_another_site_cannot_submit_the_form(visitor: TestClient, db: Session) -> None:
    response = visitor.post("/interest", json=studio(), headers={"Origin": "https://evil.example"})
    assert response.status_code == 403
    assert rows(db) == []


def test_only_the_owner_sees_interest(visitor: TestClient, db: Session, stranger: User) -> None:
    visitor.post("/interest", json=studio())
    assert visitor.get("/admin/interest").status_code == 401
    app.dependency_overrides[get_current_user] = lambda: as_user(stranger, owner=False)
    assert visitor.get("/admin/interest").status_code == 403
    [row] = rows(db)
    assert visitor.patch(f"/admin/interest/{row.id}", json={"contacted": True}).status_code == 403
    assert visitor.delete(f"/admin/interest/{row.id}").status_code == 403
    assert len(rows(db)) == 1


def test_the_owner_sees_wardrobe_and_studio_interest_apart_beside_the_accounts(
    owner_api: TestClient, db: Session, stranger: User
) -> None:
    for body in [
        studio(),
        studio(email="b@example.com", role="stylist"),
        studio(email="c@example.com", role="stylist"),
        {"kind": "wardrobe", "email": "d@example.com", "consent": True},
    ]:
        assert owner_api.post("/interest", json=body).status_code == 202
    stranger.email_verified_at = now()
    db.add(User(display_name="Unverified"))
    db.flush()

    summary = owner_api.get("/admin/interest").json()
    assert (summary["wardrobe"], summary["studio"]) == (1, 3)
    assert summary["studio_by_role"] == {"boutique": 1, "stylist": 2}
    assert (summary["accounts"], summary["verified_accounts"]) == (2, 1)  # never the owner
    assert [r["email"] for r in summary["interest"]][-1] == "asha@example.com"  # newest first
    assert set(summary["interest"][0]) == {
        "id",
        "kind",
        "role",
        "name",
        "email",
        "message",
        "created_at",
        "updated_at",
        "contacted_at",
    }


def test_the_owner_marks_contacted_and_deletes_on_request(
    owner_api: TestClient, db: Session
) -> None:
    owner_api.post("/interest", json=studio())
    [row] = rows(db)
    marked = owner_api.patch(f"/admin/interest/{row.id}", json={"contacted": True})
    assert marked.status_code == 200 and marked.json()["contacted_at"] is not None
    unmarked = owner_api.patch(f"/admin/interest/{row.id}", json={"contacted": False})
    assert unmarked.json()["contacted_at"] is None

    assert owner_api.delete(f"/admin/interest/{row.id}").status_code == 204
    assert rows(db) == []
    assert owner_api.delete(f"/admin/interest/{row.id}").status_code == 404
    assert owner_api.patch(f"/admin/interest/{row.id}", json={"contacted": True}).status_code == 404


def test_registrations_older_than_a_year_are_forgotten(owner_api: TestClient, db: Session) -> None:
    owner_api.post("/interest", json=studio())
    owner_api.post("/interest", json=studio(email="recent@example.com"))
    db.execute(
        update(Interest)
        .where(Interest.email == "asha@example.com")
        .values(updated_at=now() - timedelta(days=366))
    )
    summary = owner_api.get("/admin/interest").json()
    assert [r["email"] for r in summary["interest"]] == ["recent@example.com"]
    assert db.scalar(select(func.count()).select_from(Interest)) == 1
