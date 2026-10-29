"""Collections through the API: CRUD, duplicates, idempotency, notes, ordering, ownership."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ml import registry
from app.models import Collection, CollectionItem, Item, User
from tests.conftest import make_item, upload
from tests.images import blocks, encode

pytestmark = pytest.mark.db


@pytest.fixture(autouse=True)
def quick(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(registry, "_tagger", None)


def add_item(api: TestClient, shade: int) -> str:
    response = upload(api, encode(blocks((200, 260), (shade, 40, 80))), content_type="image/png")
    assert response.status_code == 201, response.text
    return response.json()["id"]


def create(api: TestClient, name: str = "Summer linen", **extra: Any) -> dict[str, Any]:
    response = api.post("/collections", json={"name": name, **extra})
    assert response.status_code == 201, response.text
    return response.json()


def put(
    api: TestClient, collection_id: str, item_id: str, note: str | None = None
) -> dict[str, Any]:
    body: dict[str, Any] = {"item_id": item_id}
    if note is not None:
        body["note"] = note
    response = api.post(f"/collections/{collection_id}/items", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def order(body: dict[str, Any]) -> list[tuple[str, int]]:
    return [(e["item"]["id"], e["position"]) for e in body["items"]]


# --- CRUD -------------------------------------------------------------------------------------


def test_create_list_get_rename_describe(api: TestClient) -> None:
    created = create(api, "  Festive textiles ", description="Diwali ideas")
    assert (created["name"], created["description"], created["items"]) == (
        "Festive textiles",
        "Diwali ideas",
        [],
    )

    renamed = api.patch(
        f"/collections/{created['id']}", json={"name": "Festive", "description": None}
    ).json()
    assert (renamed["name"], renamed["description"]) == ("Festive", None)
    listed = api.get("/collections").json()
    assert [(c["name"], c["item_count"], c["contains_item"]) for c in listed] == [
        ("Festive", 0, None)
    ]
    assert api.get(f"/collections/{created['id']}").json()["name"] == "Festive"


def test_duplicate_names_are_rejected_case_insensitively(
    api: TestClient, db: Session, stranger: User
) -> None:
    create(api, "Wedding Guest")
    other = create(api, "Minimalist")

    assert api.post("/collections", json={"name": "wedding guest"}).status_code == 409
    response = api.patch(f"/collections/{other['id']}", json={"name": "WEDDING GUEST"})
    assert response.status_code == 409 and response.json()["error"]["code"] == "conflict"
    assert api.get(f"/collections/{other['id']}").json()["name"] == "Minimalist"
    db.add(Collection(user_id=stranger.id, name="Wedding Guest"))  # another user may reuse it
    db.flush()


@pytest.mark.parametrize(
    "body",
    [
        {"name": "   "},
        {"name": "x" * 121},
        {"name": "ok", "extra": 1},
        {"name": "ok", "description": "d" * 2001},
    ],
)
def test_invalid_collection_input(api: TestClient, body: dict[str, Any]) -> None:
    assert api.post("/collections", json=body).status_code == 422


# --- membership, notes, ordering --------------------------------------------------------------


def test_adding_is_idempotent_and_appends_in_order(api: TestClient, db: Session) -> None:
    collection = create(api)
    a, b = add_item(api, 10), add_item(api, 20)

    put(api, collection["id"], a, note="for the sangeet")
    put(api, collection["id"], b)
    body = put(api, collection["id"], a, note="ignored second add")

    assert order(body) == [(a, 0), (b, 1)]
    assert body["items"][0]["note"] == "for the sangeet"
    assert db.scalar(select(func.count()).select_from(CollectionItem)) == 2


def test_notes_can_be_edited_and_cleared(api: TestClient) -> None:
    collection = create(api)
    item = add_item(api, 30)
    put(api, collection["id"], item)
    url = f"/collections/{collection['id']}/items/{item}"

    assert (
        api.patch(url, json={"note": "  pair with zari dupatta "}).json()["items"][0]["note"]
        == "pair with zari dupatta"
    )
    assert api.patch(url, json={"note": ""}).json()["items"][0]["note"] is None


def test_moving_renumbers_without_gaps(api: TestClient) -> None:
    collection = create(api)
    a, b, c, d = (add_item(api, s) for s in (40, 50, 60, 70))
    for item in (a, b, c, d):
        put(api, collection["id"], item)

    def move(item: str, pos: int) -> dict[str, Any]:
        url = f"/collections/{collection['id']}/items/{item}"
        return api.patch(url, json={"position": pos}).json()

    assert order(move(d, 0)) == [(d, 0), (a, 1), (b, 2), (c, 3)]
    assert order(move(d, 99)) == [(a, 0), (b, 1), (c, 2), (d, 3)]  # clamped to the end
    assert order(move(a, 2)) == [(b, 0), (c, 1), (a, 2), (d, 3)]
    assert (
        api.patch(f"/collections/{collection['id']}/items/{a}", json={"position": -1}).status_code
        == 422
    )


def test_removing_renumbers_and_unknown_members_are_404(api: TestClient) -> None:
    collection = create(api)
    a, b, c = (add_item(api, s) for s in (80, 90, 100))
    for item in (a, b, c):
        put(api, collection["id"], item)

    body = api.delete(f"/collections/{collection['id']}/items/{b}").json()

    assert order(body) == [(a, 0), (c, 1)]
    assert api.delete(f"/collections/{collection['id']}/items/{b}").status_code == 404
    assert (
        api.patch(f"/collections/{collection['id']}/items/{b}", json={"note": "x"}).status_code
        == 404
    )


def test_deleting_a_collection_keeps_its_items(api: TestClient, db: Session) -> None:
    collection = create(api)
    item = add_item(api, 110)
    put(api, collection["id"], item)

    assert api.delete(f"/collections/{collection['id']}").status_code == 204

    assert api.get(f"/collections/{collection['id']}").status_code == 404
    assert api.get(f"/items/{item}").status_code == 200
    assert db.scalar(select(func.count()).select_from(CollectionItem)) == 0


def test_deleting_an_item_removes_it_from_collections(api: TestClient) -> None:
    collection = create(api)
    a, b = add_item(api, 120), add_item(api, 130)
    put(api, collection["id"], a)
    put(api, collection["id"], b)

    api.delete(f"/items/{a}")

    detail = api.get(f"/collections/{collection['id']}").json()
    assert [e["item"]["id"] for e in detail["items"]] == [b]
    assert api.get("/collections").json()[0]["item_count"] == 1


def test_covers_counts_and_contains_item(api: TestClient) -> None:
    first, second = create(api, "First"), create(api, "Second")
    items = [add_item(api, s) for s in (140, 150, 160, 170, 180)]
    for item in items:
        put(api, first["id"], item)
    put(api, second["id"], items[0])

    listed = {c["name"]: c for c in api.get("/collections", params={"item_id": items[4]}).json()}

    assert listed["First"]["item_count"] == 5
    assert listed["First"]["cover_thumbnails"] == [
        f"/items/{i}/image?variant=thumbnail" for i in items[:4]
    ]
    assert (listed["First"]["contains_item"], listed["Second"]["contains_item"]) == (True, False)


# --- ownership --------------------------------------------------------------------------------


def test_other_users_collections_and_items_are_invisible(
    api: TestClient, db: Session, stranger: User
) -> None:
    theirs = Collection(user_id=stranger.id, name="Private")
    db.add(theirs)
    their_item = make_item(db, stranger)
    db.flush()
    mine = create(api)
    my_item = add_item(api, 190)

    assert [c["name"] for c in api.get("/collections").json()] == ["Summer linen"]
    for method, url, body in [
        ("GET", f"/collections/{theirs.id}", None),
        ("PATCH", f"/collections/{theirs.id}", {"name": "Mine now"}),
        ("DELETE", f"/collections/{theirs.id}", None),
        ("POST", f"/collections/{theirs.id}/items", {"item_id": my_item}),
        ("POST", f"/collections/{mine['id']}/items", {"item_id": str(their_item.id)}),
        ("PATCH", f"/collections/{theirs.id}/items/{their_item.id}", {"note": "x"}),
        ("DELETE", f"/collections/{theirs.id}/items/{their_item.id}", None),
    ]:
        assert api.request(method, url, json=body).status_code == 404, (method, url)
    assert db.get(Collection, theirs.id).name == "Private"  # type: ignore[union-attr]
    assert db.get(Item, their_item.id) is not None
