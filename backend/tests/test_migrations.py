"""Alembic migrations against real, disposable PostgreSQL databases."""

import pytest
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text

from app.db import migrations
from app.db.base import Base

pytestmark = pytest.mark.db

APP_TABLES = {"users", "items", "palettes", "tags", "embeddings", "collections", "collection_items"}


def table_names(url: str) -> set[str]:
    engine = create_engine(url)
    try:
        return set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def test_upgrade_creates_schema_and_pgvector_on_fresh_database(empty_db_url: str) -> None:
    assert table_names(empty_db_url) == set()

    migrations.upgrade(empty_db_url)

    assert table_names(empty_db_url) == APP_TABLES | {"alembic_version"}
    engine = create_engine(empty_db_url)
    with engine.connect() as conn:
        extension = conn.execute(
            text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
        ).scalar_one_or_none()
        revision = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        vector_type = conn.execute(
            text(
                "SELECT format_type(atttypid, atttypmod) FROM pg_attribute "
                "WHERE attrelid = 'embeddings'::regclass AND attname = 'vector'"
            )
        ).scalar_one()
        hnsw = conn.execute(
            text("SELECT indexdef FROM pg_indexes WHERE indexname = 'ix_embeddings_vector_hnsw'")
        ).scalar_one()
    engine.dispose()

    assert extension is not None
    assert revision == migrations.head_revision()
    assert vector_type == "vector(512)"
    assert "USING hnsw" in hnsw and "vector_cosine_ops" in hnsw


def test_downgrade_to_base_and_upgrade_again(empty_db_url: str) -> None:
    migrations.upgrade(empty_db_url)
    migrations.downgrade(empty_db_url, "base")

    assert table_names(empty_db_url) == {"alembic_version"}

    migrations.upgrade(empty_db_url)
    assert table_names(empty_db_url) >= APP_TABLES


def test_upgrade_is_idempotent(empty_db_url: str) -> None:
    migrations.upgrade(empty_db_url)
    migrations.upgrade(empty_db_url)  # already at head: must be a no-op, not an error

    assert table_names(empty_db_url) >= APP_TABLES


def test_models_and_migrations_do_not_drift(migrated_db_url: str) -> None:
    """Autogenerate against the migrated schema must find nothing to change."""
    engine = create_engine(migrated_db_url)
    with engine.connect() as conn:
        context = MigrationContext.configure(
            conn, opts={"compare_type": True, "compare_server_default": True}
        )
        diff = compare_metadata(context, Base.metadata)
    engine.dispose()

    assert diff == []
