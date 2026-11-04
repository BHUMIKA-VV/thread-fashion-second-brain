"""Importing this package registers every model on Base.metadata (needed by Alembic)."""

from app.models.auth import AuthToken, UserSession
from app.models.board import Board, BoardBlock
from app.models.collection import Collection, CollectionItem
from app.models.deep_analysis import DeepAnalysis, DeepAnalysisUsage
from app.models.embedding import EMBEDDING_DIM, Embedding
from app.models.interest import Interest
from app.models.item import Item
from app.models.metric import MetricCount
from app.models.outfit import CollectionOutfit, Outfit, OutfitItem
from app.models.palette import Palette
from app.models.tag import Tag
from app.models.user import User

__all__ = [
    "EMBEDDING_DIM",
    "AuthToken",
    "Board",
    "BoardBlock",
    "Collection",
    "CollectionItem",
    "CollectionOutfit",
    "DeepAnalysis",
    "DeepAnalysisUsage",
    "Embedding",
    "Interest",
    "Item",
    "MetricCount",
    "Outfit",
    "OutfitItem",
    "Palette",
    "Tag",
    "User",
    "UserSession",
]
