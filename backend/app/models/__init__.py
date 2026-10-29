"""Importing this package registers every model on Base.metadata (needed by Alembic)."""

from app.models.collection import Collection, CollectionItem
from app.models.deep_analysis import DeepAnalysis, DeepAnalysisUsage
from app.models.embedding import EMBEDDING_DIM, Embedding
from app.models.item import Item
from app.models.palette import Palette
from app.models.tag import Tag
from app.models.user import User

__all__ = [
    "EMBEDDING_DIM",
    "Collection",
    "CollectionItem",
    "DeepAnalysis",
    "DeepAnalysisUsage",
    "Embedding",
    "Item",
    "Palette",
    "Tag",
    "User",
]
