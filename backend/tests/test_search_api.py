"""Gallery search, filters, sorting, pagination and the library summary (real Postgres)."""

import random
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.ml import registry
from app.models import Item, Tag, User
from app.repositories.search import visible_tags
from app.services.tags import effective_from_rows
from tests.conftest import make_item, upload
from tests.images import blocks, encode

pytestmark = pytest.mark.db

SINDOOR = (209, 41, 28)  # named "sindoor red", family red
NEEL = (38, 59, 94)  # "neel indigo", family blue
MEHENDI = (107, 124, 42)  # "mehendi green", family green


@pytest.fixture(autouse=True)
def no_ai_tags(monkeypatch: pytest.MonkeyPatch) -> None:
    """Uploads get no AI tags, so every tag in these tests is placed explicitly."""
    monkeypatch.setattr(registry, "_tagger", None)


def add(
    api: TestClient, rgb: tuple[int, int, int], item_type: str = "fabric", accent: int = 0
) -> str:
    # A 1-pixel row keeps each file unique; at 0.25% it is below the palette's 1% threshold,
    # so it never becomes a colour (or colour family) of its own.
    image = blocks((300, 400), rgb, [((0, 399, 300, 400), (accent, accent + 1, 7))])
    response = upload(api, encode(image), item_type=item_type, content_type="image/png")
    assert response.status_code == 201, response.text
    return response.json()["id"]


def set_created(db: Session, item_ids: list[str]) -> None:
    """One test runs in one transaction, where now() is constant: give items distinct
    upload times (in real use every upload is its own transaction)."""
    base = datetime(2026, 1, 1, tzinfo=UTC)
    for minutes, item_id in enumerate(item_ids):
        db.execute(
            update(Item)
            .where(Item.id == item_id)
            .values(created_at=base + timedelta(minutes=minutes))
        )
    db.flush()
    db.expire_all()


def user_tags(
    api: TestClient,
    item_id: str,
    add: list[tuple[str, str]] = (),
    remove: list[tuple[str, str]] = (),
) -> None:  # type: ignore[assignment]
    body = {
        "add": [{"category": c, "tag": t} for c, t in add],
        "remove": [{"category": c, "tag": t} for c, t in remove],
    }
    assert api.patch(f"/items/{item_id}/tags", json=body).status_code == 200


def ai_tag(db: Session, item_id: str, category: str, tag: str, score: float = 0.8) -> None:
    db.add(
        Tag(
            item_id=item_id,
            category=category,
            tag=tag,
            source="ai",
            confidence=score,
            model_name="test",
        )
    )
    db.flush()


def ids(api: TestClient, **params: Any) -> list[str]:
    response = api.get("/items", params=params)
    assert response.status_code == 200, response.text
    return [i["id"] for i in response.json()["items"]]


# --- visible-tag parity with the tags view ---------------------------------------------------


def test_sql_visible_tags_match_the_tags_view_exactly(db: Session, owner: User) -> None:
    """Random mixes of AI tags, user removals and user additions: the SQL used by search and
    the Python merge used by the tags view must agree item by item."""
    rng = random.Random(42)
    vocabulary = [
        ("craft", "ikat"),
        ("craft", "bandhani"),
        ("pattern", "floral"),
        ("fabric", "silk"),
    ]
    items = [make_item(db, owner) for _ in range(12)]
    for item in items:
        for category, tag in vocabulary:
            roll = rng.random()
            if roll < 0.4:
                ai_tag(db, str(item.id), category, tag)
                if rng.random() < 0.4:
                    db.add(
                        Tag(
                            item_id=item.id,
                            category=category,
                            tag=tag,
                            source="user",
                            user_action="remove",
                            is_user_edited=True,
                        )
                    )
            elif roll < 0.6:
                db.add(
                    Tag(
                        item_id=item.id,
                        category=category,
                        tag=tag,
                        source="user",
                        user_action="add",
                        is_user_edited=True,
                    )
                )
    db.flush()

    vt = visible_tags()
    sql_rows = db.execute(select(vt.c.item_id, vt.c.category, vt.c.tag)).all()
    for item in items:
        python = {
            (t.category, t.tag)
            for t in effective_from_rows(
                db.scalars(select(Tag).where(Tag.item_id == item.id)).all()
            )[0]
        }
        sql = {(c, t) for i, c, t in sql_rows if i == item.id}
        assert sql == python, item.id


# --- text search ------------------------------------------------------------------------------


def test_text_search_follows_tag_corrections(api: TestClient, db: Session) -> None:
    kept, removed, added = add(api, SINDOOR), add(api, NEEL, accent=1), add(api, MEHENDI, accent=2)
    ai_tag(db, kept, "craft", "ikat")
    ai_tag(db, removed, "craft", "ikat")
    user_tags(api, removed, remove=[("craft", "ikat")])  # rejected AI tag: must not match
    user_tags(api, added, add=[("craft", "ikat")])

    body = api.get("/items", params={"q": "ikat"}).json()

    assert set(i["id"] for i in body["items"]) == {kept, added}
    assert body["total"] == 2
    assert body["reasons"][kept] == ["Tag: craft · ikat"]
    assert body["reasons"][added] == ["Tag: craft · ikat"]


def test_text_search_matches_partial_tags_colours_type_notes_and_url(api: TestClient) -> None:
    tagged, coloured, noted, linked = (
        add(api, NEEL),
        add(api, SINDOOR, accent=1),
        add(api, MEHENDI, accent=2),
        add(api, NEEL, accent=3),
    )
    user_tags(api, tagged, add=[("craft", "banarasi brocade")])
    api.patch(f"/items/{noted}", json={"notes": "Saw this at a Linen market"})
    api.patch(f"/items/{linked}", json={"source_url": "https://example.test/linen-shirt"})

    brocade = api.get("/items", params={"q": "  BROCADE "}).json()
    sindoor = api.get("/items", params={"q": "sindoor"}).json()
    linen = api.get("/items", params={"q": "linen"}).json()

    assert [i["id"] for i in brocade["items"]] == [tagged]
    assert brocade["reasons"][tagged] == ["Tag: craft · banarasi brocade"]
    assert [i["id"] for i in sindoor["items"]] == [coloured]
    assert sindoor["reasons"][coloured] == ["Colour: sindoor red"]
    assert set(i["id"] for i in linen["items"]) == {noted, linked}
    assert linen["reasons"][noted] == ["Notes mention it"]
    assert linen["reasons"][linked] == ["Source URL mentions it"]
    assert set(ids(api, q="fabric")) == {tagged, coloured, noted, linked}  # item type


def test_text_search_treats_like_wildcards_literally(api: TestClient) -> None:
    plain = add(api, NEEL)
    api.patch(f"/items/{plain}", json={"notes": "nothing special"})
    percent = add(api, SINDOOR, accent=1)
    api.patch(f"/items/{percent}", json={"notes": "50% off, top_seller"})

    assert ids(api, q="%") == [percent]
    assert ids(api, q="_") == [percent]
    assert ids(api, q="\\") == []


def test_relevance_orders_exact_tag_then_partial_tag_then_colour_then_notes(
    api: TestClient,
) -> None:
    notes_hit = add(api, MEHENDI)
    api.patch(f"/items/{notes_hit}", json={"notes": "a blue-ish mood"})
    colour_hit = add(api, NEEL, accent=1)  # family blue
    partial = add(api, SINDOOR, accent=2)
    user_tags(api, partial, add=[("aesthetic", "blue hour")])
    exact = add(api, SINDOOR, accent=3)
    user_tags(api, exact, add=[("aesthetic", "blue")])

    body = api.get("/items", params={"q": "blue", "sort": "relevance"}).json()

    assert [i["id"] for i in body["items"]] == [exact, partial, colour_hit, notes_hit]
    assert body["reasons"][colour_hit] == ["Colour family: blue"]


# --- filters ----------------------------------------------------------------------------------


def test_tag_filters_use_visible_tags_and_combine_with_and(api: TestClient, db: Session) -> None:
    a, b, c = add(api, SINDOOR), add(api, NEEL, accent=1), add(api, MEHENDI, accent=2)
    user_tags(api, a, add=[("craft", "ikat"), ("fabric", "silk")])
    user_tags(api, b, add=[("craft", "ikat")])
    ai_tag(db, c, "craft", "ikat")
    user_tags(api, c, remove=[("craft", "ikat")])

    assert set(ids(api, tag="craft:ikat")) == {a, b}
    assert set(ids(api, tag=" Craft : IKAT ")) == {a, b}  # normalised
    assert set(ids(api, tag="ikat")) == {a, b}  # any category
    assert ids(api, tag=["craft:ikat", "fabric:silk"]) == [a]  # all must match
    assert ids(api, tag="pattern:ikat") == []  # wrong category


def test_colour_family_filters(api: TestClient) -> None:
    red, blue = add(api, SINDOOR), add(api, NEEL, accent=1)
    two_tone = encode(blocks((300, 400), SINDOOR, [((0, 0, 300, 200), NEEL)]))
    both = upload(api, two_tone, item_type="fabric", content_type="image/png").json()["id"]

    assert set(ids(api, color="red")) == {red, both}
    assert set(ids(api, color="blue")) == {blue, both}
    assert ids(api, color=["red", "blue"]) == [both]
    assert api.get("/items", params={"color": "chartreuse"}).status_code == 422


def test_filters_combine(api: TestClient) -> None:
    match = add(api, SINDOOR, item_type="garment")
    user_tags(api, match, add=[("craft", "bandhani")])
    api.patch(f"/items/{match}", json={"notes": "wedding guest"})
    wrong_type = add(api, SINDOOR, item_type="fabric", accent=1)
    user_tags(api, wrong_type, add=[("craft", "bandhani")])
    api.patch(f"/items/{wrong_type}", json={"notes": "wedding guest"})
    wrong_colour = add(api, NEEL, item_type="garment", accent=2)
    user_tags(api, wrong_colour, add=[("craft", "bandhani")])

    assert ids(api, q="wedding", tag="craft:bandhani", color="red", type="garment") == [match]


def test_sort_and_pagination(api: TestClient, db: Session) -> None:
    created = [add(api, SINDOOR, accent=i) for i in range(5)]
    set_created(db, created)

    newest = ids(api, sort="newest")
    assert newest == list(reversed(created))
    assert ids(api, sort="oldest") == created
    pages = [
        api.get("/items", params={"sort": "oldest", "limit": 2, "offset": o}).json()
        for o in (0, 2, 4)
    ]
    assert [i["id"] for p in pages for i in p["items"]] == created
    assert all(p["total"] == 5 for p in pages)
    assert ids(api, sort="relevance") == newest  # relevance without q falls back to newest


@pytest.mark.parametrize(
    "params",
    [
        {"q": "x" * 101},
        {"tag": [f"craft:t{i}" for i in range(11)]},
        {"sort": "random"},
        {"limit": 0},
    ],
)
def test_invalid_search_parameters(api: TestClient, params: dict[str, Any]) -> None:
    assert api.get("/items", params=params).status_code == 422


def test_search_and_filters_never_cross_owners(
    api: TestClient, db: Session, stranger: User
) -> None:
    mine = add(api, SINDOOR)
    user_tags(api, mine, add=[("craft", "ikat")])
    theirs = make_item(db, stranger, notes="ikat sindoor red")
    ai_tag(db, str(theirs.id), "craft", "ikat")

    for params in ({"q": "ikat"}, {"tag": "craft:ikat"}, {"q": "sindoor"}, {}):
        body = api.get("/items", params=params).json()
        assert str(theirs.id) not in [i["id"] for i in body["items"]]
        assert body["total"] == 1


# --- library summary --------------------------------------------------------------------------


def test_library_summary_counts_real_data(api: TestClient, db: Session, stranger: User) -> None:
    a, b = add(api, SINDOOR, item_type="garment"), add(api, SINDOOR, accent=1)
    add(api, NEEL, accent=2)
    user_tags(api, a, add=[("craft", "ikat")])
    user_tags(api, b, add=[("craft", "ikat")])
    ai_tag(db, a, "pattern", "floral")
    user_tags(api, a, remove=[("pattern", "floral")])  # removed: must not be counted
    api.post("/collections", json={"name": "Summer"})
    make_item(db, stranger)  # never counted

    body = api.get("/items/summary").json()

    assert body["total"] == 3
    assert body["by_type"] == {"garment": 1, "fabric": 2}
    assert body["color_families"][0] == {"family": "red", "items": 2}
    assert {"category": "craft", "tag": "ikat", "items": 2} in body["tags"]
    assert not any(t["tag"] == "floral" for t in body["tags"])
    assert body["collections"] == 1
    assert len(body["recent"]) == 3
    assert db.scalar(select(Item).where(Item.user_id == stranger.id)) is not None
