"""Moodboards through the API: CRUD, block shapes and colours, ordering, captions, starting from
a collection, limits and ownership."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ml import registry
from app.models import Board, BoardBlock, Collection, Item, User
from app.services import boards as board_service
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


def create(api: TestClient, name: str = "Client: Meera, sangeet", **extra: Any) -> dict[str, Any]:
    response = api.post("/boards", json={"name": name, **extra})
    assert response.status_code == 201, response.text
    return response.json()


def add(api: TestClient, board_id: str, **block: Any) -> dict[str, Any]:
    response = api.post(f"/boards/{board_id}/blocks", json=block)
    assert response.status_code == 200, response.text
    return response.json()


def shape(body: dict[str, Any]) -> list[tuple[str, int]]:
    return [(b["kind"], b["position"]) for b in body["blocks"]]


# --- boards -----------------------------------------------------------------------------------


def test_create_list_get_rename_describe_delete(api: TestClient, db: Session) -> None:
    created = create(api, "  Monsoon wedding ", description="Indigo and gold for a day event")
    assert (created["name"], created["description"], created["blocks"]) == (
        "Monsoon wedding",
        "Indigo and gold for a day event",
        [],
    )
    assert api.get(f"/boards/{created['id']}").json()["name"] == "Monsoon wedding"

    renamed = api.patch(f"/boards/{created['id']}", json={"name": "Monsoon day", "description": ""})
    assert renamed.status_code == 200
    assert (renamed.json()["name"], renamed.json()["description"]) == ("Monsoon day", None)

    item = add_item(api, 120)
    add(api, created["id"], kind="piece", item_id=item)
    assert api.delete(f"/boards/{created['id']}").status_code == 204
    assert api.get(f"/boards/{created['id']}").status_code == 404
    assert db.scalar(select(func.count()).select_from(BoardBlock)) == 0
    assert db.get(Item, item) is not None  # the piece stays in the archive


def test_names_are_required_and_bounded(api: TestClient) -> None:
    for body in [{"name": "   "}, {"name": "x" * 121}, {"name": "ok", "colour": "red"}]:
        assert api.post("/boards", json=body).status_code == 422, body


def test_list_shows_counts_and_piece_covers_most_recent_first(api: TestClient) -> None:
    older = create(api, "Older")
    newer = create(api, "Newer")
    items = [add_item(api, shade) for shade in (40, 80, 120, 160, 200)]
    add(api, older["id"], kind="colour", hex="#263b5e")  # colours are not covers
    for item in items:
        add(api, older["id"], kind="piece", item_id=item)

    listed = api.get("/boards").json()
    assert [b["name"] for b in listed] == ["Older", "Newer"]  # Older changed last
    first = listed[0]
    assert first["block_count"] == 6
    assert first["cover_thumbnails"] == [f"/items/{i}/image?variant=thumbnail" for i in items[:4]]
    assert (listed[1]["block_count"], listed[1]["cover_thumbnails"]) == (0, [])
    assert newer["id"] == listed[1]["id"]


# --- blocks -----------------------------------------------------------------------------------


def test_each_kind_of_block_and_named_colours(api: TestClient) -> None:
    board = create(api)
    item = add_item(api, 150)
    add(api, board["id"], kind="heading", body="Colour story")
    add(api, board["id"], kind="piece", item_id=item, body="Lining fabric")
    add(api, board["id"], kind="colour", hex="#263B5E", body="For the dupatta border")
    body = add(api, board["id"], kind="note", body="Keep the gold to the borders.")

    assert shape(body) == [("heading", 0), ("piece", 1), ("colour", 2), ("note", 3)]
    heading, piece, colour, note = body["blocks"]
    assert (heading["body"], heading["item"], heading["colour"]) == ("Colour story", None, None)
    assert piece["item"]["id"] == item and piece["item"]["palette"] is not None
    assert piece["body"] == "Lining fabric"
    # A chosen colour is named the way measured palettes are, never by a model.
    assert colour["colour"] == {"hex": "#263b5e", "name": "neel indigo", "family": "blue"}
    assert note["body"] == "Keep the gold to the borders."


@pytest.mark.parametrize(
    "block",
    [
        {"kind": "piece"},
        {"kind": "colour"},
        {"kind": "colour", "hex": "263b5e"},
        {"kind": "colour", "hex": "#263b5g"},
        {"kind": "colour", "hex": "#263b5e", "item_id": "00000000-0000-0000-0000-000000000000"},
        {"kind": "note"},
        {"kind": "note", "body": "   "},
        {"kind": "note", "body": "x", "hex": "#000000"},
        {"kind": "heading", "body": "x" * 201},
        {"kind": "note", "body": "x" * 2001},
        {"kind": "sketch", "body": "x"},
        {"kind": "note", "body": "x", "position": -1},
        {"kind": "note", "body": "x", "style": "bold"},
    ],
    ids=lambda b: "-".join(f"{k}={str(v)[:12]}" for k, v in b.items()),
)
def test_malformed_blocks_are_refused(api: TestClient, block: dict[str, Any]) -> None:
    board = create(api)
    response = api.post(f"/boards/{board['id']}/blocks", json=block)
    assert response.status_code == 422, response.text
    assert api.get(f"/boards/{board['id']}").json()["blocks"] == []


def test_blocks_insert_move_and_renumber_without_gaps(api: TestClient) -> None:
    board = create(api)
    for text in ("a", "b", "c"):
        add(api, board["id"], kind="note", body=text)
    body = add(api, board["id"], kind="heading", body="Top", position=0)
    body = add(api, board["id"], kind="note", body="far", position=99)  # clamped to the end
    order = [b["body"] for b in body["blocks"]]
    assert order == ["Top", "a", "b", "c", "far"]
    assert [b["position"] for b in body["blocks"]] == [0, 1, 2, 3, 4]

    ids = {b["body"]: b["id"] for b in body["blocks"]}
    moved = api.patch(f"/boards/{board['id']}/blocks/{ids['far']}", json={"position": 1}).json()
    assert [b["body"] for b in moved["blocks"]] == ["Top", "far", "a", "b", "c"]

    removed = api.delete(f"/boards/{board['id']}/blocks/{ids['a']}").json()
    assert [(b["body"], b["position"]) for b in removed["blocks"]] == [
        ("Top", 0),
        ("far", 1),
        ("b", 2),
        ("c", 3),
    ]


def test_editing_captions_text_and_colours(api: TestClient) -> None:
    board = create(api)
    item = add_item(api, 90)
    piece = add(api, board["id"], kind="piece", item_id=item, body="Old")["blocks"][0]
    url = f"/boards/{board['id']}/blocks"

    cleared = api.patch(f"{url}/{piece['id']}", json={"body": None}).json()
    assert cleared["blocks"][0]["body"] is None

    colour = add(api, board["id"], kind="colour", hex="#263b5e")["blocks"][1]
    recoloured = api.patch(f"{url}/{colour['id']}", json={"hex": "#D1291C"}).json()
    assert recoloured["blocks"][1]["colour"]["hex"] == "#d1291c"
    assert recoloured["blocks"][1]["colour"]["family"] == "red"

    note = add(api, board["id"], kind="note", body="Keep")["blocks"][2]
    for change in [{"body": None}, {"body": "  "}, {"hex": "#000000"}]:
        response = api.patch(f"{url}/{note['id']}", json=change)
        assert response.status_code == 422, change
        assert response.json()["error"]["code"] == "invalid_block"
    assert api.patch(f"{url}/{piece['id']}", json={"hex": "#000000"}).status_code == 422
    assert api.patch(f"{url}/{colour['id']}", json={"hex": None}).status_code == 422
    heading = add(api, board["id"], kind="heading", body="Title")["blocks"][3]
    assert api.patch(f"{url}/{heading['id']}", json={"body": "x" * 201}).status_code == 422
    assert api.get(f"/boards/{board['id']}").json()["blocks"][2]["body"] == "Keep"


def test_changing_blocks_moves_the_board_forward(api: TestClient) -> None:
    board = create(api)
    after_add = add(api, board["id"], kind="note", body="One")
    assert after_add["updated_at"] > board["updated_at"]
    block = after_add["blocks"][0]["id"]
    edited = api.patch(f"/boards/{board['id']}/blocks/{block}", json={"body": "Two"}).json()
    assert edited["updated_at"] > after_add["updated_at"]
    removed = api.delete(f"/boards/{board['id']}/blocks/{block}").json()
    assert removed["updated_at"] > edited["updated_at"]


def test_deleting_a_piece_removes_only_its_blocks(api: TestClient) -> None:
    board = create(api)
    gone, kept = add_item(api, 60), add_item(api, 200)
    add(api, board["id"], kind="piece", item_id=gone)
    add(api, board["id"], kind="note", body="Between")
    add(api, board["id"], kind="piece", item_id=kept)

    assert api.delete(f"/items/{gone}").status_code == 204
    body = api.get(f"/boards/{board['id']}").json()
    assert [b["body"] or b["item"]["id"] for b in body["blocks"]] == ["Between", kept]
    # The order is still sound: moving to the end lands at the end.
    moved = api.patch(
        f"/boards/{board['id']}/blocks/{body['blocks'][0]['id']}", json={"position": 9}
    ).json()
    assert [b["position"] for b in moved["blocks"]] == [0, 1]
    assert moved["blocks"][1]["body"] == "Between"


# --- from a collection -------------------------------------------------------------------------


def test_a_board_can_start_from_a_collection(api: TestClient) -> None:
    a, b = add_item(api, 70), add_item(api, 170)
    collection = api.post("/collections", json={"name": "Shortlist"}).json()
    for item, note in ((a, "Client liked this"), (b, None)):
        body = {"item_id": item, **({"note": note} if note else {})}
        api.post(f"/collections/{collection['id']}/items", json=body)
    api.patch(f"/collections/{collection['id']}/items/{b}", json={"position": 0})

    board = create(api, "Shortlist board", from_collection_id=collection["id"])
    assert [(x["item"]["id"], x["body"]) for x in board["blocks"]] == [
        (b, None),
        (a, "Client liked this"),
    ]
    # The collection is left as it was.
    after = api.get(f"/collections/{collection['id']}").json()
    assert [e["item"]["id"] for e in after["items"]] == [b, a]


# --- limits -----------------------------------------------------------------------------------


def test_board_and_block_limits(api: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(board_service, "MAX_BLOCKS_PER_BOARD", 2)
    board = create(api)
    add(api, board["id"], kind="note", body="1")
    add(api, board["id"], kind="note", body="2")
    full = api.post(f"/boards/{board['id']}/blocks", json={"kind": "note", "body": "3"})
    assert (full.status_code, full.json()["error"]["code"]) == (409, "board_full")

    collection = api.post("/collections", json={"name": "Three"}).json()
    for shade in (30, 90, 150):
        api.post(f"/collections/{collection['id']}/items", json={"item_id": add_item(api, shade)})
    too_big = api.post("/boards", json={"name": "Big", "from_collection_id": collection["id"]})
    assert (too_big.status_code, too_big.json()["error"]["code"]) == (409, "board_full")
    assert [b["name"] for b in api.get("/boards").json()] == [board["name"]]  # nothing half-made

    monkeypatch.setattr(board_service, "MAX_BOARDS_PER_ACCOUNT", 1)
    refused = api.post("/boards", json={"name": "Second"})
    assert (refused.status_code, refused.json()["error"]["code"]) == (409, "board_limit")


# --- ownership --------------------------------------------------------------------------------


def test_other_users_boards_pieces_and_collections_are_invisible(
    api: TestClient, db: Session, stranger: User
) -> None:
    theirs = Board(user_id=stranger.id, name="Private")
    db.add(theirs)
    their_item = make_item(db, stranger)
    their_collection = Collection(user_id=stranger.id, name="Theirs")
    db.add(their_collection)
    db.flush()
    their_block = BoardBlock(
        board_id=theirs.id, user_id=stranger.id, position=0, kind="note", body="secret"
    )
    db.add(their_block)
    db.flush()
    mine = create(api)
    my_item = add_item(api, 190)
    my_block = add(api, mine["id"], kind="piece", item_id=my_item)["blocks"][0]

    assert [b["name"] for b in api.get("/boards").json()] == [mine["name"]]
    for method, url, body in [
        ("GET", f"/boards/{theirs.id}", None),
        ("PATCH", f"/boards/{theirs.id}", {"name": "Mine now"}),
        ("DELETE", f"/boards/{theirs.id}", None),
        ("POST", f"/boards/{theirs.id}/blocks", {"kind": "piece", "item_id": my_item}),
        ("POST", f"/boards/{mine['id']}/blocks", {"kind": "piece", "item_id": str(their_item.id)}),
        ("PATCH", f"/boards/{theirs.id}/blocks/{their_block.id}", {"body": "x"}),
        ("DELETE", f"/boards/{theirs.id}/blocks/{their_block.id}", None),
        # A block of mine can't be reached through their board, nor theirs through mine.
        ("PATCH", f"/boards/{theirs.id}/blocks/{my_block['id']}", {"body": "x"}),
        ("DELETE", f"/boards/{mine['id']}/blocks/{their_block.id}", None),
        ("POST", "/boards", {"name": "Copy", "from_collection_id": str(their_collection.id)}),
    ]:
        assert api.request(method, url, json=body).status_code == 404, (method, url)
    db.refresh(theirs)
    assert theirs.name == "Private"
    assert db.get(BoardBlock, their_block.id).body == "secret"  # type: ignore[union-attr]
    assert len(api.get("/boards").json()) == 1


# --- colour story ------------------------------------------------------------------------------


def test_the_colour_story_follows_the_blocks(api: TestClient) -> None:
    board = create(api)
    assert board["colour_story"] == {
        "measured": {
            "dominant": [],
            "shared": [],
            "complementary": [],
            "contrasting": [],
            "pieces_with_palette": 0,
            "pieces_without_palette": 0,
        },
        "chosen": [],
        "harmony": None,
    }

    item = add_item(api, 200)  # mostly (200, 40, 80), a deep pink-red
    body = add(api, board["id"], kind="piece", item_id=item)
    measured = body["colour_story"]["measured"]
    assert measured["pieces_with_palette"] == 1 and measured["dominant"]
    assert measured["dominant"][0]["item_ids"] == [item]

    piece_hex = body["blocks"][0]["item"]["palette"]["colors"][0]["hex"]
    body = add(api, board["id"], kind="colour", hex=piece_hex)
    body = add(api, board["id"], kind="colour", hex="#1f8a8a")
    near, far = body["colour_story"]["chosen"]
    assert (near["block_id"], near["on_pieces"]) == (body["blocks"][1]["id"], True)
    assert near["nearest"] == {
        "hex": piece_hex,
        "name": near["nearest"]["name"],
        "item_id": item,
        "distance": 0.0,
    }
    assert far["on_pieces"] is False and far["family"] == "teal"
    assert body["colour_story"]["harmony"] in {"complementary", "mixed"}

    # Removing the piece leaves the chosen colours, now with nothing measured to match.
    removed = api.delete(f"/boards/{board['id']}/blocks/{body['blocks'][0]['id']}").json()
    story = removed["colour_story"]
    assert story["measured"]["pieces_with_palette"] == 0
    assert [c["nearest"] for c in story["chosen"]] == [None, None]
