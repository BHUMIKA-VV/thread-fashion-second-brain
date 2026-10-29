"""Repositories always filter by owner; other users' rows behave as if they do not exist."""

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import Item, User
from app.repositories.collections import CollectionRepository
from app.repositories.errors import ConflictError, NotFoundError
from app.repositories.items import ItemRepository
from app.repositories.users import ensure_user
from tests.conftest import item_fields, make_item

pytestmark = pytest.mark.db


# --- items -----------------------------------------------------------------------------


def test_item_crud(db: Session, owner: User) -> None:
    repo = ItemRepository(db, owner.id)

    item = repo.create(**item_fields(type="fabric"))
    assert repo.get(item.id) is item

    repo.update(item.id, notes="Ajrakh from Kutch", source_url="https://example.test/a")
    assert repo.get_or_raise(item.id).notes == "Ajrakh from Kutch"

    repo.delete(item.id)
    assert repo.get(item.id) is None


def test_item_list_is_owner_only_and_newest_first(db: Session, owner: User, stranger: User) -> None:
    older = make_item(db, owner)
    newer = make_item(db, owner)
    make_item(db, stranger)
    # Same transaction => same now(); set explicit times to make ordering deterministic.
    older.created_at = func.now() - func.make_interval(0, 0, 0, 0, 1)
    db.flush()

    listed = ItemRepository(db, owner.id).list()

    assert [i.id for i in listed] == [newer.id, older.id]


def test_items_of_other_users_are_invisible(db: Session, owner: User, stranger: User) -> None:
    foreign = make_item(db, stranger)
    repo = ItemRepository(db, owner.id)

    assert repo.get(foreign.id) is None
    assert repo.find_by_hash(foreign.content_hash) is None
    with pytest.raises(NotFoundError):
        repo.update(foreign.id, notes="mine now")
    with pytest.raises(NotFoundError):
        repo.delete(foreign.id)
    assert db.get(Item, foreign.id) is not None


def test_duplicate_upload_raises_conflict_and_session_survives(db: Session, owner: User) -> None:
    repo = ItemRepository(db, owner.id)
    first = repo.create(**item_fields())

    with pytest.raises(ConflictError):
        repo.create(**item_fields(content_hash=first.content_hash))

    assert repo.find_by_hash(first.content_hash) is first
    assert len(repo.list()) == 1


def test_system_fields_are_not_editable(db: Session, owner: User) -> None:
    item = make_item(db, owner)

    with pytest.raises(ValueError, match="processing_status"):
        ItemRepository(db, owner.id).update(item.id, processing_status="completed")


# --- collections -----------------------------------------------------------------------


def test_collection_crud(db: Session, owner: User) -> None:
    repo = CollectionRepository(db, owner.id)

    collection = repo.create("  Summer linen ", "Breathable whites and naturals")
    assert collection.name == "Summer linen"

    repo.update(collection.id, name="Summer linens")
    repo.update(collection.id, description=None)
    updated = repo.get_or_raise(collection.id)
    assert (updated.name, updated.description) == ("Summer linens", None)
    assert [c.id for c in repo.list()] == [collection.id]

    repo.delete(collection.id)
    assert repo.get(collection.id) is None


def test_duplicate_collection_name_raises_conflict(db: Session, owner: User) -> None:
    repo = CollectionRepository(db, owner.id)
    repo.create("Festive textiles")
    other = repo.create("Minimalist wardrobe")

    with pytest.raises(ConflictError):
        repo.create("FESTIVE TEXTILES")
    with pytest.raises(ConflictError):
        repo.update(other.id, name="festive textiles")

    # The failed rename was rolled back and the session is still usable.
    assert repo.get_or_raise(other.id).name == "Minimalist wardrobe"
    assert len(repo.list()) == 2


def test_adding_items_appends_positions_and_is_idempotent(db: Session, owner: User) -> None:
    repo = CollectionRepository(db, owner.id)
    collection = repo.create("Wedding guest ideas")
    first, second = make_item(db, owner), make_item(db, owner)

    link_a = repo.add_item(collection.id, first.id, note="for the sangeet")
    link_b = repo.add_item(collection.id, second.id)
    again = repo.add_item(collection.id, first.id)

    assert (link_a.position, link_b.position) == (0, 1)
    assert again is link_a
    assert [i.id for i in repo.list_items(collection.id)] == [first.id, second.id]

    repo.remove_item(collection.id, first.id)
    assert [i.id for i in repo.list_items(collection.id)] == [second.id]
    with pytest.raises(NotFoundError):
        repo.remove_item(collection.id, first.id)


def test_collections_cannot_mix_owners(db: Session, owner: User, stranger: User) -> None:
    mine = CollectionRepository(db, owner.id)
    theirs = CollectionRepository(db, stranger.id)
    my_collection = mine.create("Mine")
    their_collection = theirs.create("Theirs")
    my_item, their_item = make_item(db, owner), make_item(db, stranger)

    with pytest.raises(NotFoundError):
        mine.add_item(my_collection.id, their_item.id)
    with pytest.raises(NotFoundError):
        mine.add_item(their_collection.id, my_item.id)
    with pytest.raises(NotFoundError):
        mine.list_items(their_collection.id)
    with pytest.raises(NotFoundError):
        mine.delete(their_collection.id)
    assert mine.get(their_collection.id) is None


# --- development user ------------------------------------------------------------------


def test_ensure_user_is_idempotent(db: Session) -> None:
    dev_id = Settings(database_url="postgresql+psycopg://unused/db").dev_user_id

    ensure_user(db, dev_id, "Local developer")
    ensure_user(db, dev_id, "Local developer")

    assert db.scalar(select(func.count()).select_from(User).where(User.id == dev_id)) == 1
