"""initial schema: users, items, palettes, tags, embeddings, collections

Enables pgvector and creates the full MVP schema. Generated with autogenerate, then
reviewed by hand (pgvector extension and import added).

Revision ID: b987c40bd0a0
Revises:
Create Date: 2026-10-24 16:17:51.700596+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

# Frozen at the value this migration was written for (OpenCLIP ViT-B/32 = 512).
# Do not import app.models.EMBEDDING_DIM here: migrations must not change if app code does.
EMBEDDING_DIM = 512

revision: str = "b987c40bd0a0"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # pgvector provides the vector type, distance operators and HNSW index method.
    # Requires a role allowed to create extensions (the Docker dev role is a superuser).
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
    )
    op.create_table(
        "collections",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "char_length(btrim(name)) > 0", name=op.f("ck_collections_name_not_blank")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_collections_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_collections")),
        sa.UniqueConstraint("id", "user_id", name=op.f("uq_collections_id_user_id")),
    )
    op.create_index(
        "uq_collections_user_id_lower_name",
        "collections",
        ["user_id", sa.literal_column("lower(name)")],
        unique=True,
    )
    op.create_table(
        "items",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("type", sa.String(length=20), server_default="other", nullable=False),
        sa.Column("suggested_type", sa.String(length=20), nullable=True),
        sa.Column("original_key", sa.String(length=512), nullable=False),
        sa.Column("thumbnail_key", sa.String(length=512), nullable=True),
        sa.Column("cutout_key", sa.String(length=512), nullable=True),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("mime_type", sa.String(length=50), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column(
            "processing_status", sa.String(length=30), server_default="queued", nullable=False
        ),
        sa.Column("processing_error", sa.Text(), nullable=True),
        sa.Column(
            "stage_status",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("analyzed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ai_description", sa.Text(), nullable=True),
        sa.Column("ai_description_model", sa.String(length=100), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "content_hash ~ '^[0-9a-f]{64}$'", name=op.f("ck_items_content_hash_sha256")
        ),
        sa.CheckConstraint(
            "processing_status IN ('queued', 'processing', 'completed', 'partially_completed', 'failed')",
            name=op.f("ck_items_processing_status"),
        ),
        sa.CheckConstraint(
            "suggested_type IN ('outfit', 'garment', 'fabric', 'accessory', 'other')",
            name=op.f("ck_items_suggested_type"),
        ),
        sa.CheckConstraint(
            "type IN ('outfit', 'garment', 'fabric', 'accessory', 'other')",
            name=op.f("ck_items_type"),
        ),
        sa.CheckConstraint("attempts >= 0", name=op.f("ck_items_non_negative_attempts")),
        sa.CheckConstraint(
            "char_length(source_url) <= 2048", name=op.f("ck_items_source_url_length")
        ),
        sa.CheckConstraint("file_size > 0", name=op.f("ck_items_positive_file_size")),
        sa.CheckConstraint("width > 0 AND height > 0", name=op.f("ck_items_positive_dimensions")),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_items_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_items")),
        sa.UniqueConstraint("id", "user_id", name=op.f("uq_items_id_user_id")),
        sa.UniqueConstraint("user_id", "content_hash", name=op.f("uq_items_user_id_content_hash")),
    )
    op.create_index(
        "ix_items_pending",
        "items",
        ["created_at"],
        unique=False,
        postgresql_where=sa.text("processing_status IN ('queued', 'processing')"),
    )
    op.create_index(
        "ix_items_user_id_created_at",
        "items",
        ["user_id", sa.literal_column("created_at DESC")],
        unique=False,
    )
    op.create_index("ix_items_user_id_type", "items", ["user_id", "type"], unique=False)
    op.create_table(
        "collection_items",
        sa.Column("collection_id", sa.Uuid(), nullable=False),
        sa.Column("item_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("position >= 0", name=op.f("ck_collection_items_non_negative_position")),
        sa.ForeignKeyConstraint(
            ["collection_id", "user_id"],
            ["collections.id", "collections.user_id"],
            name="fk_collection_items_collection_owner",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["item_id", "user_id"],
            ["items.id", "items.user_id"],
            name="fk_collection_items_item_owner",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("collection_id", "item_id", name=op.f("pk_collection_items")),
    )
    op.create_index("ix_collection_items_item_id", "collection_items", ["item_id"], unique=False)
    op.create_table(
        "embeddings",
        sa.Column("item_id", sa.Uuid(), nullable=False),
        sa.Column("model_name", sa.String(length=100), nullable=False),
        sa.Column("vector", Vector(EMBEDDING_DIM), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["item_id"], ["items.id"], name=op.f("fk_embeddings_item_id_items"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("item_id", name=op.f("pk_embeddings")),
    )
    op.create_index(
        "ix_embeddings_vector_hnsw",
        "embeddings",
        ["vector"],
        unique=False,
        postgresql_using="hnsw",
        postgresql_ops={"vector": "vector_cosine_ops"},
    )
    op.create_table(
        "palettes",
        sa.Column("item_id", sa.Uuid(), nullable=False),
        sa.Column("colors", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("harmony", sa.String(length=20), nullable=True),
        sa.Column(
            "color_families",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'::text[]"),
            nullable=False,
        ),
        sa.Column("source", sa.String(length=20), server_default="original", nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "harmony IN ('monochromatic', 'analogous', 'complementary', 'neutral', 'mixed')",
            name=op.f("ck_palettes_harmony"),
        ),
        sa.CheckConstraint(
            "jsonb_typeof(colors) = 'array'", name=op.f("ck_palettes_colors_is_array")
        ),
        sa.CheckConstraint("source IN ('cutout', 'original')", name=op.f("ck_palettes_source")),
        sa.ForeignKeyConstraint(
            ["item_id"], ["items.id"], name=op.f("fk_palettes_item_id_items"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("item_id", name=op.f("pk_palettes")),
    )
    op.create_index(
        "ix_palettes_color_families",
        "palettes",
        ["color_families"],
        unique=False,
        postgresql_using="gin",
    )
    op.create_table(
        "tags",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("item_id", sa.Uuid(), nullable=False),
        sa.Column("tag", sa.String(length=80), nullable=False),
        sa.Column("category", sa.String(length=20), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("source", sa.String(length=10), nullable=False),
        sa.Column("user_action", sa.String(length=10), nullable=True),
        sa.Column("is_user_edited", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("model_name", sa.String(length=100), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "(source = 'ai' AND user_action IS NULL AND confidence IS NOT NULL AND NOT is_user_edited) OR (source = 'user' AND user_action IS NOT NULL AND is_user_edited)",
            name=op.f("ck_tags_source_consistency"),
        ),
        sa.CheckConstraint(
            "category IN ('garment', 'silhouette', 'pattern', 'fabric', 'aesthetic', 'occasion', 'craft')",
            name=op.f("ck_tags_category"),
        ),
        sa.CheckConstraint("source IN ('ai', 'user')", name=op.f("ck_tags_source")),
        sa.CheckConstraint(
            "user_action IS NULL OR user_action IN ('add', 'remove')",
            name=op.f("ck_tags_user_action"),
        ),
        sa.CheckConstraint("char_length(btrim(tag)) > 0", name=op.f("ck_tags_tag_not_blank")),
        sa.CheckConstraint(
            "confidence IS NULL OR confidence BETWEEN 0 AND 1", name=op.f("ck_tags_confidence")
        ),
        sa.ForeignKeyConstraint(
            ["item_id"], ["items.id"], name=op.f("fk_tags_item_id_items"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tags")),
        sa.UniqueConstraint(
            "item_id", "category", "tag", "source", name=op.f("uq_tags_item_id_category_tag_source")
        ),
    )
    op.create_index("ix_tags_category_tag", "tags", ["category", "tag"], unique=False)
    op.create_index(op.f("ix_tags_item_id"), "tags", ["item_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_tags_item_id"), table_name="tags")
    op.drop_index("ix_tags_category_tag", table_name="tags")
    op.drop_table("tags")
    op.drop_index("ix_palettes_color_families", table_name="palettes", postgresql_using="gin")
    op.drop_table("palettes")
    op.drop_index(
        "ix_embeddings_vector_hnsw",
        table_name="embeddings",
        postgresql_using="hnsw",
        postgresql_ops={"vector": "vector_cosine_ops"},
    )
    op.drop_table("embeddings")
    op.drop_index("ix_collection_items_item_id", table_name="collection_items")
    op.drop_table("collection_items")
    op.drop_index("ix_items_user_id_type", table_name="items")
    op.drop_index("ix_items_user_id_created_at", table_name="items")
    op.drop_index(
        "ix_items_pending",
        table_name="items",
        postgresql_where=sa.text("processing_status IN ('queued', 'processing')"),
    )
    op.drop_table("items")
    op.drop_index("uq_collections_user_id_lower_name", table_name="collections")
    op.drop_table("collections")
    op.drop_table("users")
    # The extension is left installed: other schemas in the same database may rely on it,
    # and keeping it makes downgrade/upgrade cycles safe.
