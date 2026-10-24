from typing import TYPE_CHECKING
from uuid import UUID

from pgvector.sqlalchemy import Vector
from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAtMixin

if TYPE_CHECKING:
    from app.models.item import Item

# Output size of OpenCLIP ViT-B/32 image embeddings. The worker (Milestone 5) asserts the
# loaded model really produces this size before writing anything. Changing models with a
# different size requires a new migration.
EMBEDDING_DIM = 512


class Embedding(CreatedAtMixin, Base):
    """One image embedding per item, used for cosine-similarity search."""

    __tablename__ = "embeddings"
    __table_args__ = (
        # HNSW approximate-nearest-neighbour index for cosine distance (the <=> operator).
        Index(
            "ix_embeddings_vector_hnsw",
            "vector",
            postgresql_using="hnsw",
            postgresql_ops={"vector": "vector_cosine_ops"},
        ),
    )

    item_id: Mapped[UUID] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), primary_key=True
    )
    model_name: Mapped[str] = mapped_column(String(100))
    vector: Mapped[list[float]] = mapped_column(Vector(EMBEDDING_DIM))

    item: Mapped["Item"] = relationship(back_populates="embedding")
