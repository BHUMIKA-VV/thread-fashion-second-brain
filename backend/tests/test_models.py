"""Database-level rules: constraints, defaults, cascades and pgvector behaviour."""

import time
from typing import Any

import pytest
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import DataError, IntegrityError, StatementError
from sqlalchemy.orm import Session

from app.models import (
    EMBEDDING_DIM,
    Collection,
    CollectionItem,
    Embedding,
    Item,
    Palette,
    Tag,
    User,
)
from tests.conftest import item_fields, make_item

pytestmark = pytest.mark.db


def assert_rejected(db: Session, row: Any, constraint: str) -> None:
    """Flushing `row` must fail with the named constraint; the session stays usable."""
    with pytest.raises(IntegrityError) as excinfo, db.begin_nested():
        db.add(row)
        db.flush()
    assert constraint in str(excinfo.value.orig)


def unit_vector(index: int) -> list[float]:
    vector = [0.0] * EMBEDDING_DIM
    vector[index] = 1.0
    return vector


# --- items -----------------------------------------------------------------------------


def test_item_defaults(db: Session, owner: User) -> None:
    item = make_item(db, owner)
    db.refresh(item)

    assert item.type == "other"
    assert item.processing_status == "queued"
    assert item.stage_status == {}
    assert item.attempts == 0
    assert item.created_at is not None and item.updated_at is not None


@pytest.mark.parametrize(
    ("overrides", "constraint"),
    [
        ({"type": "shoe"}, "ck_items_type"),
        ({"suggested_type": "shoe"}, "ck_items_suggested_type"),
        ({"processing_status": "done"}, "ck_items_processing_status"),
        ({"content_hash": "not-a-sha256"}, "ck_items_content_hash_sha256"),
        ({"width": 0}, "ck_items_positive_dimensions"),
        ({"file_size": 0}, "ck_items_positive_file_size"),
        ({"attempts": -1}, "ck_items_non_negative_attempts"),
        ({"source_url": "https://x.test/" + "a" * 2048}, "ck_items_source_url_length"),
    ],
)
def test_item_check_constraints(
    db: Session, owner: User, overrides: dict[str, Any], constraint: str
) -> None:
    assert_rejected(db, Item(user_id=owner.id, **item_fields(**overrides)), constraint)


def test_duplicate_content_hash_is_per_user(db: Session, owner: User, stranger: User) -> None:
    first = make_item(db, owner)

    assert_rejected(
        db,
        Item(user_id=owner.id, **item_fields(content_hash=first.content_hash)),
        "uq_items_user_id_content_hash",
    )
    # Another user may save the very same image.
    make_item(db, stranger, content_hash=first.content_hash)


def test_updated_at_moves_forward_on_update(db: Session, owner: User) -> None:
    item = make_item(db, owner)
    db.refresh(item)
    before = item.updated_at

    time.sleep(0.01)
    item.notes = "Seen at a Jaipur block-print studio"
    db.flush()
    db.refresh(item)

    assert item.updated_at > before
    assert item.created_at <= before


# --- tags ------------------------------------------------------------------------------


def test_ai_and_user_rows_for_the_same_tag_coexist(db: Session, owner: User) -> None:
    item = make_item(db, owner)
    db.add_all(
        [
            Tag(item_id=item.id, tag="ikat", category="craft", source="ai", confidence=0.71),
            Tag(
                item_id=item.id,
                tag="ikat",
                category="craft",
                source="user",
                user_action="remove",
                is_user_edited=True,
            ),
        ]
    )
    db.flush()

    assert db.scalar(select(func.count()).select_from(Tag).where(Tag.item_id == item.id)) == 2


@pytest.mark.parametrize(
    ("fields", "constraint"),
    [
        ({"source": "ai", "confidence": None}, "ck_tags_source_consistency"),
        ({"source": "ai", "confidence": 0.5, "user_action": "add"}, "ck_tags_source_consistency"),
        ({"source": "ai", "confidence": 0.5, "is_user_edited": True}, "ck_tags_source_consistency"),
        ({"source": "user", "is_user_edited": True}, "ck_tags_source_consistency"),
        ({"source": "user", "user_action": "add"}, "ck_tags_source_consistency"),
        ({"source": "ai", "confidence": 1.5}, "ck_tags_confidence"),
        ({"source": "robot", "confidence": 0.5}, "ck_tags_source"),
        ({"source": "ai", "confidence": 0.5, "category": "mood"}, "ck_tags_category"),
        ({"source": "ai", "confidence": 0.5, "tag": "   "}, "ck_tags_tag_not_blank"),
    ],
)
def test_tag_constraints(db: Session, owner: User, fields: dict[str, Any], constraint: str) -> None:
    item = make_item(db, owner)
    values = {"item_id": item.id, "tag": "silk", "category": "fabric", **fields}
    assert_rejected(db, Tag(**values), constraint)


def test_duplicate_tag_from_same_source_is_rejected(db: Session, owner: User) -> None:
    item = make_item(db, owner)
    db.add(Tag(item_id=item.id, tag="silk", category="fabric", source="ai", confidence=0.4))
    db.flush()

    assert_rejected(
        db,
        Tag(item_id=item.id, tag="silk", category="fabric", source="ai", confidence=0.6),
        "uq_tags_item_id_category_tag_source",
    )


# --- palettes --------------------------------------------------------------------------


def test_palette_round_trips_json_and_families(db: Session, owner: User) -> None:
    item = make_item(db, owner)
    colors = [{"hex": "#b4654a", "name": "terracotta", "percentage": 100.0, "lab": [50, 30, 30]}]
    db.add(Palette(item_id=item.id, colors=colors, harmony="monochromatic", color_families=["red"]))
    db.flush()

    found = db.scalar(
        select(Item.id).join(Palette).where(Palette.color_families.overlap(["red", "blue"]))
    )
    assert found == item.id


def test_palette_colors_must_be_a_json_array(db: Session, owner: User) -> None:
    item = make_item(db, owner)
    assert_rejected(
        db, Palette(item_id=item.id, colors={"hex": "#fff"}), "ck_palettes_colors_is_array"
    )


# --- embeddings ------------------------------------------------------------------------


def test_embedding_dimension_is_enforced_by_postgres(db: Session, owner: User) -> None:
    item = make_item(db, owner)
    with pytest.raises((DataError, StatementError)), db.begin_nested():
        db.add(Embedding(item_id=item.id, model_name="test", vector=[0.1] * (EMBEDDING_DIM - 1)))
        db.flush()


def test_cosine_distance_orders_nearest_first(db: Session, owner: User) -> None:
    query, near, far = (make_item(db, owner) for _ in range(3))
    near_vector = unit_vector(0)
    near_vector[1] = 0.2
    db.add_all(
        [
            Embedding(item_id=query.id, model_name="test", vector=unit_vector(0)),
            Embedding(item_id=near.id, model_name="test", vector=near_vector),
            Embedding(item_id=far.id, model_name="test", vector=unit_vector(1)),
        ]
    )
    db.flush()

    target = db.scalar(select(Embedding.vector).where(Embedding.item_id == query.id))
    distance = Embedding.vector.cosine_distance(target)
    rows = db.execute(
        select(Embedding.item_id, distance).where(Embedding.item_id != query.id).order_by(distance)
    ).all()

    assert [row[0] for row in rows] == [near.id, far.id]
    assert rows[0][1] == pytest.approx(1 - 1 / (1.04**0.5), abs=1e-6)
    assert rows[1][1] == pytest.approx(1.0, abs=1e-6)


# --- cascades --------------------------------------------------------------------------


def test_deleting_an_item_cascades_in_the_database(db: Session, owner: User) -> None:
    item = make_item(db, owner)
    collection = Collection(user_id=owner.id, name="Festive textiles")
    db.add(collection)
    db.flush()
    db.add_all(
        [
            Palette(item_id=item.id, colors=[]),
            Tag(item_id=item.id, tag="silk", category="fabric", source="ai", confidence=0.4),
            Embedding(item_id=item.id, model_name="test", vector=unit_vector(3)),
            CollectionItem(collection_id=collection.id, item_id=item.id, user_id=owner.id),
        ]
    )
    db.flush()

    # Core DELETE (not the ORM) so this proves the ON DELETE CASCADE rules themselves.
    db.execute(delete(Item).where(Item.id == item.id))
    db.expire_all()

    for model in (Palette, Tag, Embedding, CollectionItem):
        assert db.scalar(select(func.count()).select_from(model)) == 0
    assert db.get(Collection, collection.id) is not None


def test_deleting_a_collection_keeps_its_items(db: Session, owner: User) -> None:
    item = make_item(db, owner)
    collection = Collection(user_id=owner.id, name="Summer linen")
    db.add(collection)
    db.flush()
    db.add(CollectionItem(collection_id=collection.id, item_id=item.id, user_id=owner.id))
    db.flush()

    db.execute(delete(Collection).where(Collection.id == collection.id))
    db.expire_all()

    assert db.get(Item, item.id) is not None
    assert db.scalar(select(func.count()).select_from(CollectionItem)) == 0


def test_deleting_a_user_removes_everything_they_own(db: Session, owner: User) -> None:
    make_item(db, owner)
    db.add(Collection(user_id=owner.id, name="Minimalist wardrobe"))
    db.flush()

    db.execute(delete(User).where(User.id == owner.id))

    assert db.scalar(select(func.count()).select_from(Item)) == 0
    assert db.scalar(select(func.count()).select_from(Collection)) == 0


# --- collections and ownership ---------------------------------------------------------


def test_collection_names_are_unique_per_user_ignoring_case(
    db: Session, owner: User, stranger: User
) -> None:
    db.add(Collection(user_id=owner.id, name="Summer Linen"))
    db.flush()

    assert_rejected(
        db, Collection(user_id=owner.id, name="summer linen"), "uq_collections_user_id_lower_name"
    )
    db.add(Collection(user_id=stranger.id, name="Summer Linen"))
    db.flush()


def test_blank_collection_name_is_rejected(db: Session, owner: User) -> None:
    assert_rejected(db, Collection(user_id=owner.id, name="  "), "ck_collections_name_not_blank")


def test_database_rejects_cross_owner_collection_membership(
    db: Session, owner: User, stranger: User
) -> None:
    """Even code that bypasses the repositories cannot link another user's item."""
    foreign_item = make_item(db, stranger)
    collection = Collection(user_id=owner.id, name="Wedding guest ideas")
    db.add(collection)
    db.flush()

    # Claiming the collection owner's id fails on the item's composite key...
    assert_rejected(
        db,
        CollectionItem(collection_id=collection.id, item_id=foreign_item.id, user_id=owner.id),
        "fk_collection_items_item_owner",
    )
    # ...and claiming the item owner's id fails on the collection's composite key.
    assert_rejected(
        db,
        CollectionItem(collection_id=collection.id, item_id=foreign_item.id, user_id=stranger.id),
        "fk_collection_items_collection_owner",
    )


def test_pgvector_extension_is_installed(db: Session) -> None:
    assert db.execute(text("SELECT 1 FROM pg_extension WHERE extname = 'vector'")).scalar_one() == 1
