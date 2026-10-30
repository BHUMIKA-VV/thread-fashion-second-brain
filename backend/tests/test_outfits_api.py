"""Outfits through the API: CRUD, limits, atomic replacement, ownership and showcase separation."""

import json
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.ml import registry
from app.models import Collection, CollectionOutfit, Item, Outfit, OutfitItem, User
from app.services import outfits as outfits_service
from tests.conftest import make_item, upload
from tests.images import blocks, encode

pytestmark = pytest.mark.db


@pytest.fixture(autouse=True)
def quick(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(registry, "_tagger", None)


def add_item(api: TestClient, rgb: tuple[int, int, int] = (200, 40, 80)) -> str:
    response = upload(api, encode(blocks((200, 260), rgb)), content_type="image/png")
    assert response.status_code == 201, response.text
    return response.json()["id"]


def create(api: TestClient, name: str = "Sangeet look", **extra: Any) -> dict[str, Any]:
    response = api.post("/outfits", json={"name": name, **extra})
    assert response.status_code == 201, response.text
    return response.json()


def put_items(api: TestClient, outfit_id: str, *ids: str, role: str = "piece") -> Any:
    return api.put(
        f"/outfits/{outfit_id}/items", json={"items": [{"item_id": i, "role": role} for i in ids]}
    )


def order(body: dict[str, Any]) -> list[str]:
    return [p["item"]["id"] for p in body["pieces"]]


# --- details ----------------------------------------------------------------------------------


def test_create_read_update_delete(api: TestClient, db: Session) -> None:
    created = create(
        api,
        "  Sangeet look ",
        description="For the evening",
        occasion="Festive",
        season="winter",
        style_tags=["Silk", " silk ", "Bold"],
        notes="Borrow the dupatta",
        layout="grid",
    )
    assert created["name"] == "Sangeet look"
    assert created["style_tags"] == ["silk", "bold"]
    assert (created["season"], created["layout"], created["pieces"]) == ("winter", "grid", [])

    read = api.get(f"/outfits/{created['id']}").json()
    assert read["notes"] == "Borrow the dupatta"

    changed = api.patch(
        f"/outfits/{created['id']}", json={"name": "Mehendi look", "occasion": None, "season": None}
    ).json()
    assert (changed["name"], changed["occasion"], changed["season"]) == ("Mehendi look", None, None)
    assert changed["notes"] == "Borrow the dupatta"  # omitted: unchanged

    assert api.delete(f"/outfits/{created['id']}").status_code == 204
    assert api.get(f"/outfits/{created['id']}").status_code == 404
    assert db.scalar(select(func.count()).select_from(Outfit)) == 0


@pytest.mark.parametrize(
    "body",
    [
        {"name": "   "},
        {"name": "x" * 121},
        {"name": "ok", "season": "harvest"},
        {"name": "ok", "layout": "freeform"},
        {"name": "ok", "occasion": "x" * 81},
        {"name": "ok", "style_tags": ["t"] * 13},
        {"name": "ok", "user_id": str(uuid4())},  # the owner never comes from the client
    ],
)
def test_invalid_details_are_refused(api: TestClient, body: dict[str, Any]) -> None:
    assert api.post("/outfits", json=body).status_code == 422


def test_list_searches_filters_and_pages(api: TestClient) -> None:
    first = create(api, "Winter wedding", occasion="Bridal", season="winter", style_tags=["zari"])
    create(api, "Office linen", occasion="Formal", season="summer")
    item = add_item(api)
    put_items(api, first["id"], item)

    listed = api.get("/outfits").json()
    assert listed["total"] == 2
    assert listed["outfits"][0]["name"] == "Winter wedding"  # most recently changed
    assert listed["outfits"][0]["piece_count"] == 1
    assert listed["outfits"][0]["cover_thumbnails"] == [f"/items/{item}/image?variant=thumbnail"]
    assert "notes" not in listed["outfits"][0]

    def names(**params: Any) -> list[str]:
        return [o["name"] for o in api.get("/outfits", params=params).json()["outfits"]]

    assert names(q="ZARI") == ["Winter wedding"]
    assert names(q="100%") == []  # wildcards are literal
    assert names(occasion="formal") == ["Office linen"]
    assert names(season="winter") == ["Winter wedding"]
    assert len(names(limit=1)) == 1
    assert names(limit=1, offset=5) == []


# --- pieces -----------------------------------------------------------------------------------


def test_the_list_you_send_becomes_the_outfit_in_that_order(api: TestClient) -> None:
    outfit = create(api)
    a, b, c = (
        add_item(api, (200, 30, 40)),
        add_item(api, (30, 60, 180)),
        add_item(api, (30, 150, 60)),
    )

    body = api.put(
        f"/outfits/{outfit['id']}/items",
        json={
            "items": [
                {"item_id": a},
                {"item_id": b, "role": "accessory"},
                {"item_id": c, "role": "inspiration"},
            ]
        },
    ).json()
    assert order(body) == [a, b, c]
    assert [p["role"] for p in body["pieces"]] == ["piece", "accessory", "inspiration"]
    assert [p["position"] for p in body["pieces"]] == [0, 1, 2]

    assert order(put_items(api, outfit["id"], c, a).json()) == [c, a]  # reorder and remove
    assert order(put_items(api, outfit["id"], c, b).json()) == [c, b]  # replace
    assert order(put_items(api, outfit["id"]).json()) == []


def test_a_failed_replacement_leaves_the_outfit_untouched(
    api: TestClient, db: Session, stranger: User
) -> None:
    outfit = create(api)
    a, b = add_item(api, (200, 30, 40)), add_item(api, (30, 60, 180))
    before = put_items(api, outfit["id"], a, b).json()
    theirs = make_item(db, stranger)
    missing = str(uuid4())

    for bad, status in [
        ((b, str(theirs.id)), 404),  # another owner's piece
        ((b, missing), 404),  # no such piece
        ((a, a), 422),  # the same piece twice
    ]:
        response = put_items(api, outfit["id"], *bad)
        assert response.status_code == status, bad
    after = api.get(f"/outfits/{outfit['id']}").json()
    assert order(after) == order(before)
    assert after["updated_at"] == before["updated_at"]


def test_the_piece_limit_and_a_bad_role_are_refused_atomically(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(outfits_service, "MAX_PIECES_PER_OUTFIT", 2)
    outfit = create(api)
    a, b, c = (
        add_item(api, (200, 30, 40)),
        add_item(api, (30, 60, 180)),
        add_item(api, (30, 150, 60)),
    )
    assert put_items(api, outfit["id"], a, b).status_code == 200

    too_many = put_items(api, outfit["id"], a, b, c)
    assert too_many.status_code == 422
    assert too_many.json()["error"]["code"] == "outfit_too_large"
    assert put_items(api, outfit["id"], c, role="hat").status_code == 422
    assert order(api.get(f"/outfits/{outfit['id']}").json()) == [a, b]


def test_the_default_limits_are_the_approved_ones() -> None:
    assert outfits_service.MAX_PIECES_PER_OUTFIT == 12
    assert outfits_service.MAX_OUTFITS_PER_ACCOUNT == 200


def test_deleting_a_piece_keeps_the_outfit_and_its_other_pieces(api: TestClient) -> None:
    outfit = create(api)
    a, b, c = (
        add_item(api, (200, 30, 40)),
        add_item(api, (30, 60, 180)),
        add_item(api, (30, 150, 60)),
    )
    put_items(api, outfit["id"], a, b, c)

    assert api.delete(f"/items/{b}").status_code == 204

    after = api.get(f"/outfits/{outfit['id']}").json()
    assert order(after) == [a, c]
    assert [p["position"] for p in after["pieces"]] == [0, 1]  # no gap shown
    assert order(put_items(api, outfit["id"], c, a).json()) == [c, a]  # still editable


def test_deleting_an_outfit_keeps_its_pieces(api: TestClient, db: Session) -> None:
    outfit = create(api)
    item = add_item(api)
    put_items(api, outfit["id"], item)
    assert api.delete(f"/outfits/{outfit['id']}").status_code == 204
    assert api.get(f"/items/{item}").status_code == 200
    assert db.scalar(select(func.count()).select_from(OutfitItem)) == 0


def test_duplicate_copies_details_and_pieces_but_not_collections(api: TestClient) -> None:
    source = create(api, "x" * 120, occasion="Festive", season="winter", style_tags=["silk"])
    a, b = add_item(api, (200, 30, 40)), add_item(api, (30, 60, 180))
    put_items(api, source["id"], a, b)
    collection = api.post("/collections", json={"name": "Weddings"}).json()
    api.post(f"/collections/{collection['id']}/outfits", json={"outfit_id": source["id"]})

    response = api.post(f"/outfits/{source['id']}/duplicate")
    assert response.status_code == 201
    copy = response.json()
    assert copy["id"] != source["id"]
    assert copy["name"].endswith(" (copy)") and len(copy["name"]) <= 120
    assert order(copy) == [a, b]
    assert (copy["occasion"], copy["season"], copy["style_tags"]) == ("Festive", "winter", ["silk"])
    assert copy["collection_ids"] == []

    assert order(put_items(api, copy["id"], b).json()) == [b]  # independent of the source
    assert order(api.get(f"/outfits/{source['id']}").json()) == [a, b]


def test_the_outfit_limit_covers_creating_and_duplicating(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(outfits_service, "MAX_OUTFITS_PER_ACCOUNT", 2)
    first = create(api, "One")
    create(api, "Two")

    for response in (
        api.post("/outfits", json={"name": "Three"}),
        api.post(f"/outfits/{first['id']}/duplicate"),
    ):
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "outfit_limit"
    assert api.get("/outfits").json()["total"] == 2


# --- colours ----------------------------------------------------------------------------------


def test_colours_come_from_the_stored_palettes(api: TestClient) -> None:
    outfit = create(api)
    a = add_item(api, (200, 30, 40))
    b = add_item(api, (0, 150, 160))
    body = put_items(api, outfit["id"], a, b).json()
    colours = body["colours"]

    stored = {c["hex"] for piece in body["pieces"] for c in piece["item"]["palette"]["colors"]}
    assert colours["pieces_with_palette"] == 2
    assert colours["dominant"]
    assert {c["hex"] for c in colours["dominant"]} <= stored
    assert {str(i) for c in colours["dominant"] for i in c["item_ids"]} <= {a, b}


def test_an_empty_outfit_has_no_colours(api: TestClient) -> None:
    colours = create(api)["colours"]
    assert colours["dominant"] == []
    assert colours["pieces_with_palette"] == 0


# --- collections ------------------------------------------------------------------------------


def test_outfits_can_be_organised_into_collections(api: TestClient) -> None:
    outfit = create(api)
    collection = api.post("/collections", json={"name": "Weddings"}).json()
    assert collection["outfits"] == []
    url = f"/collections/{collection['id']}/outfits"

    added = api.post(url, json={"outfit_id": outfit["id"]})
    assert added.status_code == 200
    assert [o["id"] for o in added.json()["outfits"]] == [outfit["id"]]
    assert api.post(url, json={"outfit_id": outfit["id"]}).status_code == 200  # no-op
    assert api.get(f"/outfits/{outfit['id']}").json()["collection_ids"] == [collection["id"]]

    removed = api.delete(f"{url}/{outfit['id']}")
    assert removed.status_code == 200 and removed.json()["outfits"] == []
    assert api.delete(f"{url}/{outfit['id']}").status_code == 404
    assert api.get(f"/outfits/{outfit['id']}").status_code == 200  # the outfit is kept


def test_deleting_either_side_only_removes_the_link(api: TestClient, db: Session) -> None:
    keep_outfit = create(api, "Kept")
    gone_outfit = create(api, "Gone")
    collection = api.post("/collections", json={"name": "Weddings"}).json()
    doomed = api.post("/collections", json={"name": "Doomed"}).json()
    for outfit in (keep_outfit, gone_outfit):
        api.post(f"/collections/{collection['id']}/outfits", json={"outfit_id": outfit["id"]})
    api.post(f"/collections/{doomed['id']}/outfits", json={"outfit_id": keep_outfit["id"]})

    assert api.delete(f"/outfits/{gone_outfit['id']}").status_code == 204
    assert [o["id"] for o in api.get(f"/collections/{collection['id']}").json()["outfits"]] == [
        keep_outfit["id"]
    ]
    assert api.delete(f"/collections/{doomed['id']}").status_code == 204
    assert api.get(f"/outfits/{keep_outfit['id']}").json()["collection_ids"] == [collection["id"]]


# --- ownership --------------------------------------------------------------------------------


def test_another_owners_outfits_and_links_look_missing(
    api: TestClient, db: Session, stranger: User
) -> None:
    theirs = Outfit(user_id=stranger.id, name="Private look", notes="secret note")
    their_collection = Collection(user_id=stranger.id, name="Their collection")
    db.add_all([theirs, their_collection])
    their_item = make_item(db, stranger)
    db.flush()
    db.add(OutfitItem(outfit_id=theirs.id, item_id=their_item.id, user_id=stranger.id, position=0))
    db.add(
        CollectionOutfit(
            collection_id=their_collection.id, outfit_id=theirs.id, user_id=stranger.id
        )
    )
    db.flush()
    mine = create(api)
    my_item = add_item(api)
    my_collection = api.post("/collections", json={"name": "Mine"}).json()

    assert [o["name"] for o in api.get("/outfits").json()["outfits"]] == ["Sangeet look"]
    assert api.get("/outfits", params={"q": "secret"}).json()["total"] == 0
    for method, url, body in [
        ("GET", f"/outfits/{theirs.id}", None),
        ("PATCH", f"/outfits/{theirs.id}", {"name": "Mine now"}),
        ("DELETE", f"/outfits/{theirs.id}", None),
        ("POST", f"/outfits/{theirs.id}/duplicate", None),
        ("PUT", f"/outfits/{theirs.id}/items", {"items": [{"item_id": my_item}]}),
        ("PUT", f"/outfits/{mine['id']}/items", {"items": [{"item_id": str(their_item.id)}]}),
        ("POST", f"/collections/{my_collection['id']}/outfits", {"outfit_id": str(theirs.id)}),
        ("POST", f"/collections/{their_collection.id}/outfits", {"outfit_id": mine["id"]}),
        ("DELETE", f"/collections/{their_collection.id}/outfits/{theirs.id}", None),
        ("DELETE", f"/collections/{my_collection['id']}/outfits/{theirs.id}", None),
    ]:
        assert api.request(method, url, json=body).status_code == 404, (method, url)
    db.expire_all()
    assert db.get(Outfit, theirs.id).name == "Private look"  # type: ignore[union-attr]
    assert db.get(Item, their_item.id) is not None
    assert (
        db.scalar(
            select(func.count()).select_from(OutfitItem).where(OutfitItem.outfit_id == theirs.id)
        )
        == 1
    )


def test_the_database_itself_refuses_mixed_owners(db: Session, owner: User, stranger: User) -> None:
    outfit = Outfit(user_id=owner.id, name="Mine")
    collection = Collection(user_id=stranger.id, name="Theirs")
    db.add_all([outfit, collection])
    theirs = make_item(db, stranger)
    db.flush()

    for row, constraint in [
        (
            OutfitItem(outfit_id=outfit.id, item_id=theirs.id, user_id=owner.id, position=0),
            "fk_outfit_items_item_owner",
        ),
        (
            OutfitItem(outfit_id=outfit.id, item_id=theirs.id, user_id=stranger.id, position=0),
            "fk_outfit_items_outfit_owner",
        ),
        (
            CollectionOutfit(collection_id=collection.id, outfit_id=outfit.id, user_id=owner.id),
            "fk_collection_outfits_collection_owner",
        ),
    ]:
        with pytest.raises(IntegrityError, match=constraint), db.begin_nested():
            db.add(row)
            db.flush()


def test_signed_out_requests_are_refused(client: TestClient) -> None:
    for method, url in [
        ("GET", "/outfits"),
        ("POST", "/outfits"),
        ("GET", f"/outfits/{uuid4()}"),
        ("PUT", f"/outfits/{uuid4()}/items"),
    ]:
        assert client.request(method, url, json={}).status_code == 401, url


# --- the public showcase ----------------------------------------------------------------------


def test_the_showcase_never_shows_outfits(api: TestClient, db: Session, owner: User) -> None:
    owner.is_owner = True
    item = add_item(api)
    api.patch(f"/items/{item}", json={"notes": "public piece"})
    db.scalar(select(Item).where(Item.id == item)).is_public = True
    outfit = create(api, "Private-outfit-name", notes="private-outfit-note")
    put_items(api, outfit["id"], item)
    collection = api.post("/collections", json={"name": "Published"}).json()
    api.post(f"/collections/{collection['id']}/items", json={"item_id": item})
    api.post(f"/collections/{collection['id']}/outfits", json={"outfit_id": outfit["id"]})
    db.get(Collection, collection["id"]).is_public = True  # type: ignore[union-attr]
    db.flush()

    pages = [
        api.get("/showcase/summary"),
        api.get("/showcase/items"),
        api.get(f"/showcase/items/{item}"),
        api.get(f"/showcase/collections/{collection['id']}"),
    ]
    for page in pages:
        text = json.dumps(page.json()) if page.status_code == 200 else page.text
        assert "Private-outfit-name" not in text
        assert "private-outfit-note" not in text
        assert '"outfits"' not in text
    assert pages[3].status_code == 200
