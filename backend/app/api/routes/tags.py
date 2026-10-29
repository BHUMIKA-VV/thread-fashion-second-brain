import contextlib
from uuid import UUID

from fastapi import APIRouter

from app.api.routes.items import Service
from app.ml import registry, vocabulary
from app.ml.tagging import tagger_version
from app.models import Item
from app.schemas.tags import (
    CategoryScores,
    ItemTags,
    LabelScoreRead,
    TagEditRequest,
    TagRead,
    TagScores,
    Vocabulary,
    VocabularyCategory,
)
from app.services.embeddings import EmbeddingFailed, EmbeddingService
from app.services.tags import (
    EffectiveTag,
    ItemNotIndexed,
    TagEdit,
    TagService,
    TagValidationError,
)

router = APIRouter(tags=["tags"])


def _read(tag: EffectiveTag) -> TagRead:
    return TagRead(
        category=tag.category,  # type: ignore[arg-type]
        tag=tag.tag,
        source=tag.source,  # type: ignore[arg-type]
        score=tag.score,
        custom=tag.custom,
        outdated=tag.outdated,
        is_guess=vocabulary.BY_NAME[tag.category].is_guess,
    )


def _index_if_needed(service: Service, item: Item) -> None:
    """Items uploaded while the model was loading have no embedding yet, and AI tags come from
    the embedding. Once the model is ready, index such an item here (fast: one image read and
    embed). Never waits for a model load; known failures are not retried on every view."""
    embedder = registry.get_embedder_if_ready()
    if embedder is None or (item.stage_status or {}).get("embedding") == "failed":
        return
    if item.embedding is None or item.embedding.model_name != embedder.model_name:
        with contextlib.suppress(EmbeddingFailed):  # recorded on the item
            EmbeddingService(service.db, service.storage, service.owner_id).index(item, embedder)


def _item_tags(service: Service, item_id: UUID) -> ItemTags:
    item = service.items.get_or_raise(item_id)
    _index_if_needed(service, item)
    tags = TagService(service.db)
    status = tags.ensure_current(item)  # tags now if possible; never waits for a model load
    shown, removed = tags.effective(item)
    tagger = registry.get_tagger_if_ready()
    return ItemTags(
        item_id=item.id,
        status=status,  # type: ignore[arg-type]
        version=tagger.version if tagger else None,
        suggested_type=item.suggested_type,  # type: ignore[arg-type]
        tags=[_read(t) for t in shown],
        removed=[_read(t) for t in removed],
    )


@router.get("/items/{item_id}/tags", response_model=ItemTags)
def get_item_tags(item_id: UUID, service: Service) -> ItemTags:
    """Effective tags: AI tags + your additions - your removals.

    If the image model is ready and this item's AI tags are missing or outdated, they are
    computed now from the stored embedding (fast; no image is re-read)."""
    return _item_tags(service, item_id)


@router.patch(
    "/items/{item_id}/tags",
    response_model=ItemTags,
    responses={422: {"description": "Invalid tag or category (code invalid_tag)"}},
)
def edit_item_tags(item_id: UUID, body: TagEditRequest, service: Service) -> ItemTags:
    """Add or remove tags. Stored as your corrections, separately from AI tags, so
    re-analysis never overwrites them. Removing an AI tag hides it; adding it back restores it."""
    item = service.items.get_or_raise(item_id)
    try:
        TagService(service.db).edit(
            item,
            add=[TagEdit(e.category.value, e.tag) for e in body.add],
            remove=[TagEdit(e.category.value, e.tag) for e in body.remove],
        )
    except TagValidationError:
        service.db.rollback()
        raise
    return _item_tags(service, item_id)


@router.get(
    "/items/{item_id}/tag-scores",
    response_model=TagScores,
    responses={
        409: {"description": "The item has no image embedding yet (code not_indexed)"},
        503: {"description": "model_loading or model_unavailable"},
    },
)
def get_tag_scores(item_id: UUID, service: Service) -> TagScores:
    """Every label's score in every category, including the ones below the thresholds."""
    item = service.items.get_or_raise(item_id)
    registry.get_embedder_nowait()  # 503 while loading / unavailable
    scores = TagService(service.db).scores(item)
    if scores is None:
        raise ItemNotIndexed(
            "This item has no image embedding yet. Re-analyse it, or open Similar pieces, "
            "to index it."
        )
    tagger = registry.get_tagger_if_ready()
    return TagScores(
        item_id=item.id,
        version=tagger.version if tagger else tagger_version("unknown"),
        categories=[
            CategoryScores(
                category=name,  # type: ignore[arg-type]
                is_guess=vocabulary.BY_NAME[name].is_guess,
                min_score=vocabulary.BY_NAME[name].min_score,
                min_margin=vocabulary.BY_NAME[name].min_margin,
                max_tags=vocabulary.BY_NAME[name].max_tags,
                labels=[
                    LabelScoreRead(tag=s.tag, score=s.score, none=s.none, passes=s.passes)
                    for s in labels
                ],
            )
            for name, labels in scores.items()
        ],
    )


@router.get("/tags/vocabulary", response_model=Vocabulary)
def get_vocabulary() -> Vocabulary:
    """The controlled vocabulary (suggestions for adding tags)."""
    return Vocabulary(
        version=f"{vocabulary.TEMPLATE_VERSION}/v{vocabulary.VOCABULARY_HASH}",
        categories=[
            VocabularyCategory(
                category=c.name,
                is_guess=c.is_guess,
                max_tags=c.max_tags,
                tags=vocabulary.vocabulary_tags(c.name.value),
            )
            for c in vocabulary.CATEGORIES
        ],
    )
