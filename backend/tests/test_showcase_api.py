"""The public showcase: only the owner's published pieces and collections, read-only, and no
way for a private piece (or a private note) to leak through any route."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_storage
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.main import app
from app.models import Embedding, Item, User
from app.storage import LocalStorage
from tests.conftest import as_user, make_item, upload
from tests.images import blocks, encode

pytestmark = pytest.mark.db

RED = (200, 30, 40)


@pytest.fixture
def owner_account(db: Session, owner: User) -> User:
    owner.is_owner = True
    db.flush()
    return owner


@pytest.fixture
def visitor(db: Session, storage: LocalStorage, settings: Settings) -> Iterator[TestClient]:
    """A signed-out browser (nothing but the database, storage and settings overridden)."""
    app.dependency_overrides.update(
        {get_db: lambda: db, get_storage: lambda: storage, get_settings: lambda: settings}
    )
    yield TestClient(app, raise_server_exceptions=False)


def piece(api: TestClient, colour: tuple[int, int, int] = RED, notes: str | None = None) -> str:
    image = blocks((240, 320), colour, [((0, 300, 240, 320), (colour[0] // 2, 9, 9))])
    response = upload(api, encode(image), "fabric", "p.png", "image/png")
    assert response.status_code == 201, response.text
    item_id = response.json()["id"]
    if notes:
        assert api.patch(f"/items/{item_id}", json={"notes": notes}).status_code == 200
    return item_id


def publish(api: TestClient, item_id: str, public: bool = True) -> None:
    response = api.put(f"/items/{item_id}/showcase", json={"public": public})
    assert response.status_code == 200, response.text
    assert response.json()["is_public"] is public


def listed(client: TestClient, **params: object) -> set[str]:
    response = client.get("/showcase/items", params=params)
    assert response.status_code == 200, response.text
    return {item["id"] for item in response.json()["items"]}


# --- set-up and defaults ---------------------------------------------------------------------


def test_no_owner_means_no_showcase(visitor: TestClient) -> None:
    for path in ("/showcase", "/showcase/items", "/showcase/collections"):
        response = visitor.get(path)
        assert response.status_code == 404, path
        assert response.json()["error"]["code"] == "showcase_not_set_up"


def test_everything_starts_private(
    api: TestClient, owner_account: User, visitor: TestClient
) -> None:
    piece(api)
    summary = visitor.get("/showcase").json()
    assert summary["owner_name"] == "Owner"
    assert summary["total"] == 0 and summary["recent"] == []
    assert listed(visitor) == set()
    assert visitor.get("/showcase/collections").json() == []


# --- what a visitor can and cannot see -------------------------------------------------------


def test_only_published_pieces_are_shown_and_without_private_fields(
    api: TestClient, owner_account: User, visitor: TestClient
) -> None:
    public = piece(api, notes="Bought from Ammi in Kutch")
    private = piece(api, (30, 60, 180), notes="Secret gift for Ravi")
    publish(api, public)

    assert listed(visitor) == {public}
    detail = visitor.get(f"/showcase/items/{public}").json()
    for field in (
        "notes",
        "source_url",
        "file_size",
        "mime_type",
        "processing_status",
        "is_public",
    ):
        assert field not in detail, field
    assert detail["image_url"] == f"/showcase/items/{public}/image?variant=original"
    assert detail["palette"]["colors"]
    assert isinstance(detail["tags"], list)

    for path in (
        f"/showcase/items/{private}",
        f"/showcase/items/{private}/image",
        f"/showcase/items/{private}/image?variant=original",
        f"/showcase/items/{private}/similar",
    ):
        assert visitor.get(path).status_code == 404, path


def test_counts_cover_published_pieces_only(
    api: TestClient, owner_account: User, visitor: TestClient
) -> None:
    publish(api, piece(api))
    piece(api, (30, 60, 180))
    piece(api, (30, 160, 60))
    summary = visitor.get("/showcase").json()
    assert summary["total"] == 1
    assert summary["by_type"] == {"fabric": 1}
    assert {f["family"] for f in summary["color_families"]} <= {"red", "pink", "brown", "maroon"}
    assert len(summary["recent"]) == 1


def test_search_never_matches_or_quotes_notes(
    api: TestClient, owner_account: User, visitor: TestClient
) -> None:
    public = piece(api, notes="Kutch mirrorwork from the Ammi workshop")
    piece(api, (30, 60, 180), notes="Kutch embroidery, private")
    publish(api, public)

    # A note's words find nothing, even on the published piece: notes stay private.
    assert listed(visitor, q="ammi") == set()
    assert listed(visitor, q="kutch") == set()
    # The owner's own search still finds both.
    assert api.get("/items", params={"q": "kutch"}).json()["total"] == 2
    # Matching by type works, and reasons never mention notes.
    page = visitor.get("/showcase/items", params={"q": "fabric"}).json()
    assert {i["id"] for i in page["items"]} == {public}
    assert all("Notes" not in r for reasons in page["reasons"].values() for r in reasons)


def test_filters_apply_inside_the_published_set(
    api: TestClient, owner_account: User, visitor: TestClient
) -> None:
    red = piece(api)
    piece(api, (200, 32, 44))  # also red, private
    publish(api, red)
    assert listed(visitor, color="red") == {red}
    assert listed(visitor, type="garment") == set()


def test_another_accounts_piece_never_appears_even_if_flagged(
    api: TestClient, owner_account: User, stranger: User, visitor: TestClient, db: Session
) -> None:
    sneaky = make_item(db, stranger, is_public=True)
    assert listed(visitor) == set()
    assert visitor.get(f"/showcase/items/{sneaky.id}").status_code == 404


# --- similar pieces ----------------------------------------------------------------------------


def test_similar_pieces_come_from_published_pieces_only(
    api: TestClient, owner_account: User, visitor: TestClient
) -> None:
    query = piece(api, RED)
    near_public = piece(api, (205, 35, 45))
    near_private = piece(api, (198, 28, 38))
    far_public = piece(api, (20, 160, 60))
    for item_id in (query, near_public, far_public):
        publish(api, item_id)
    # The owner's own view indexes everything (fake embedder).
    assert api.get(f"/items/{query}/similar").status_code == 200

    response = visitor.get(f"/showcase/items/{query}/similar").json()
    ids = [r["item"]["id"] for r in response["results"]]
    assert near_private not in ids
    assert ids == [near_public, far_public]  # nearest first
    assert response["compared"] == 2


def test_the_showcase_never_indexes_anything(
    api: TestClient, owner_account: User, visitor: TestClient, db: Session
) -> None:
    item_id = piece(api)
    publish(api, item_id)
    db.execute(delete(Embedding))
    db.flush()

    response = visitor.get(f"/showcase/items/{item_id}/similar")
    assert response.status_code == 200
    assert response.json()["results"] == []
    assert db.scalar(select(func.count()).select_from(Embedding)) == 0


# --- collections -------------------------------------------------------------------------------


def test_a_published_collection_shows_only_its_published_pieces(
    api: TestClient, owner_account: User, visitor: TestClient
) -> None:
    public = piece(api)
    private = piece(api, (30, 60, 180))
    publish(api, public)
    collection = api.post("/collections", json={"name": "Kutch", "description": "Mirrorwork"})
    cid = collection.json()["id"]
    for item_id in (public, private):
        added = api.post(f"/collections/{cid}/items", json={"item_id": item_id, "note": "mine"})
        assert added.status_code == 200

    assert visitor.get(f"/showcase/collections/{cid}").status_code == 404  # still private
    assert api.put(f"/collections/{cid}/showcase", json={"public": True}).json()["changed"] == 1
    assert api.get(f"/collections/{cid}").json()["is_public"] is True

    shown = visitor.get(f"/showcase/collections/{cid}").json()
    assert [i["id"] for i in shown["items"]] == [public]
    assert shown["description"] == "Mirrorwork"
    assert "mine" not in str(shown)  # per-piece notes stay private
    [summary] = visitor.get("/showcase/collections").json()
    assert summary["item_count"] == 1
    assert summary["cover_thumbnails"] == [f"/showcase/items/{public}/image?variant=thumbnail"]

    api.put(f"/collections/{cid}/showcase", json={"public": False})
    assert visitor.get(f"/showcase/collections/{cid}").status_code == 404


# --- publishing ------------------------------------------------------------------------------


def test_only_the_owner_can_publish(api: TestClient, owner: User, db: Session) -> None:
    item_id = piece(api)
    cid = api.post("/collections", json={"name": "Mine"}).json()["id"]
    app.dependency_overrides[get_current_user] = lambda: as_user(owner, owner=False)

    for method, path, body in (
        ("PUT", f"/items/{item_id}/showcase", {"public": True}),
        ("POST", "/items/showcase-all", {"public": True}),
        ("PUT", f"/collections/{cid}/showcase", {"public": True}),
    ):
        response = api.request(method, path, json=body)
        assert response.status_code == 403, path
        assert response.json()["error"]["code"] == "owner_only"
    assert db.scalar(select(func.count()).where(Item.is_public)) == 0


def test_the_owner_cannot_publish_someone_elses_piece(
    api: TestClient, owner_account: User, stranger: User, db: Session
) -> None:
    theirs = make_item(db, stranger)
    assert api.put(f"/items/{theirs.id}/showcase", json={"public": True}).status_code == 404
    db.refresh(theirs)
    assert theirs.is_public is False


def test_publish_and_unpublish_everything(
    api: TestClient, owner_account: User, stranger: User, visitor: TestClient, db: Session
) -> None:
    ids = {piece(api), piece(api, (30, 60, 180))}
    make_item(db, stranger)

    assert api.post("/items/showcase-all", json={"public": True}).json() == {
        "public": True,
        "changed": 2,
    }
    assert listed(visitor) == ids
    assert db.scalar(select(func.count()).where(Item.is_public, Item.user_id == stranger.id)) == 0
    assert api.post("/items/showcase-all", json={"public": False}).json()["changed"] == 2
    assert listed(visitor) == set()


def test_unpublishing_hides_a_piece_at_once(
    api: TestClient, owner_account: User, visitor: TestClient
) -> None:
    item_id = piece(api)
    publish(api, item_id)
    assert visitor.get(f"/showcase/items/{item_id}").status_code == 200
    publish(api, item_id, public=False)
    assert visitor.get(f"/showcase/items/{item_id}").status_code == 404
    assert visitor.get(f"/showcase/items/{item_id}/image").status_code == 404


def test_public_images_are_cached_briefly_and_sandboxed(
    api: TestClient, owner_account: User, visitor: TestClient
) -> None:
    item_id = piece(api)
    publish(api, item_id)
    response = visitor.get(f"/showcase/items/{item_id}/image")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=300"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in response.headers["content-security-policy"]
    # The owner's own image route stays private.
    assert api.get(f"/items/{item_id}/image").headers["cache-control"].startswith("private")


def test_the_showcase_has_no_write_routes(
    api: TestClient, owner_account: User, visitor: TestClient
) -> None:
    item_id = piece(api)
    publish(api, item_id)
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        for path in ("/showcase/items", f"/showcase/items/{item_id}", "/showcase/collections"):
            assert visitor.request(method, path).status_code == 405, (method, path)
    paths = app.openapi()["paths"]
    for path, operations in paths.items():
        if path.startswith("/showcase"):
            assert set(operations) == {"get"}, path


def test_the_owner_can_filter_their_archive_by_showcase(
    api: TestClient, owner_account: User
) -> None:
    public = piece(api)
    private = piece(api, (30, 60, 180))
    publish(api, public)
    ids = lambda **p: {i["id"] for i in api.get("/items", params=p).json()["items"]}  # noqa: E731
    assert ids(published="true") == {public}
    assert ids(published="false") == {private}
    assert ids() == {public, private}


# --- response-size limits --------------------------------------------------------------------


def test_a_public_collection_returns_at_most_200_pieces_in_order(
    owner_account: User, visitor: TestClient, db: Session
) -> None:
    from app.models import Collection, CollectionItem

    collection = Collection(user_id=owner_account.id, name="Everything", is_public=True)
    db.add(collection)
    db.flush()
    public_ids = []
    for position in range(205):
        item = make_item(db, owner_account, is_public=True)
        db.add(
            CollectionItem(
                collection_id=collection.id,
                item_id=item.id,
                user_id=owner_account.id,
                position=position * 2,
            )
        )
        public_ids.append(str(item.id))
    private = [make_item(db, owner_account) for _ in range(3)]
    for offset, item in enumerate(private):  # interleaved with the public ones
        db.add(
            CollectionItem(
                collection_id=collection.id,
                item_id=item.id,
                user_id=owner_account.id,
                position=offset * 2 + 1,
            )
        )
    db.flush()

    shown = visitor.get(f"/showcase/collections/{collection.id}").json()
    assert len(shown["items"]) == 200
    assert shown["total"] == 205
    assert [i["id"] for i in shown["items"]] == public_ids[:200]  # in collection order
    assert not {str(i.id) for i in private} & {i["id"] for i in shown["items"]}

    [summary] = visitor.get("/showcase/collections").json()
    assert summary["item_count"] == 205
    assert len(summary["cover_thumbnails"]) == 4


def test_the_public_collection_list_returns_at_most_50_newest_first(
    owner_account: User, visitor: TestClient, db: Session
) -> None:
    from datetime import UTC, datetime, timedelta

    from app.models import Collection

    start = datetime(2026, 1, 1, tzinfo=UTC)
    public = []
    for i in range(53):
        collection = Collection(
            user_id=owner_account.id, name=f"Public {i}", is_public=True, updated_at=start
        )
        db.add(collection)
        db.flush()
        public.append(collection)
    for i in range(2):
        db.add(Collection(user_id=owner_account.id, name=f"Private {i}"))
    db.flush()
    # updated_at is set by the database on insert; give each a distinct time.
    for i, collection in enumerate(public):
        collection.updated_at = start + timedelta(minutes=i)
    db.flush()

    listed = visitor.get("/showcase/collections").json()
    assert len(listed) == 50
    assert [c["name"] for c in listed] == [f"Public {i}" for i in range(52, 2, -1)]
