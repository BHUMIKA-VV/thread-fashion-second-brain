"""Zero-shot tag selection rules and the text-vector cache (no real model, no database)."""

from pathlib import Path

import numpy as np
import pytest

from app.ml import tagging, vocabulary
from app.ml.tagging import Tagger, cache_key
from app.ml.vocabulary import BY_NAME, CATEGORIES, ITEM_TYPE_LABELS
from app.models.enums import ItemType, TagCategory
from app.services.tags import TagEdit, validate

# --- a tagger with hand-made label vectors -------------------------------------------------
# Every label (and item type) gets its own axis, so an image vector built from a few axes
# produces exactly predictable softmax scores.

AXES: dict[tuple[str, str], int] = {}
for _category in CATEGORIES:
    for _label in _category.labels:
        AXES[(_category.name.value, _label.tag)] = len(AXES)
for _item_type, _ in ITEM_TYPE_LABELS:
    AXES[("type", _item_type.value)] = len(AXES)
DIM = len(AXES)


def unit(index: int) -> np.ndarray:
    v = np.zeros(DIM, dtype=np.float32)
    v[index] = 1.0
    return v


def axis_tagger(logit_scale: float = 10.0) -> Tagger:
    matrices = {
        c.name.value: np.stack([unit(AXES[(c.name.value, label.tag)]) for label in c.labels])
        for c in CATEGORIES
    }
    types = np.stack([unit(AXES[("type", t.value)]) for t, _ in ITEM_TYPE_LABELS])
    return Tagger("test-model", matrices, types, logit_scale)


def image(**weights: float) -> np.ndarray:
    """image(**{"craft:ikat": 1.0, ...}) -> unit vector mixing those label axes."""
    v = np.zeros(DIM, dtype=np.float32)
    for key, weight in weights.items():
        category, tag = key.split(":")
        v[AXES[(category, tag)]] = weight
    return v / np.linalg.norm(v)


def stored(
    tagger: Tagger, vector: np.ndarray, item_type: str | None = None
) -> set[tuple[str, str]]:
    return {(p.category, p.tag) for p in tagger.predict(vector, item_type)}


def test_a_clear_winner_is_stored_with_its_score() -> None:
    predictions = axis_tagger().predict(image(**{"craft:ikat": 1.0}))
    ikat = [p for p in predictions if p.category == "craft"]
    # Softmax with logit scale 10: e^10 / (e^10 + (n - 1) * e^0) for n craft labels.
    n = len(BY_NAME["craft"].labels)
    expected = np.exp(10) / (np.exp(10) + (n - 1))
    assert [p.tag for p in ikat] == ["ikat"]
    assert ikat[0].score == pytest.approx(expected, abs=1e-4)


def test_a_close_call_stores_nothing() -> None:
    # Two crafts almost equally likely: below the margin, so no craft tag at all.
    tags = stored(axis_tagger(), image(**{"craft:ikat": 1.0, "craft:bandhani": 0.98}))
    assert not any(category == "craft" for category, _ in tags)


def test_none_of_these_wins_means_no_tag() -> None:
    tags = stored(axis_tagger(), image(**{"craft:none": 1.0}))
    assert not any(category == "craft" for category, _ in tags)


def test_multi_label_categories_add_a_second_strong_label() -> None:
    # Floral clearly first, striped a strong second: both stored (pattern allows 2).
    tagger = axis_tagger(logit_scale=6.0)
    vector = image(**{"pattern:floral": 1.0, "pattern:striped": 0.85})
    scores = {s.tag: s for s in tagger.scores(vector)["pattern"]}

    tags = stored(tagger, vector)

    assert ("pattern", "floral") in tags
    assert (("pattern", "striped") in tags) == (
        scores["striped"].score >= BY_NAME["pattern"].min_score
    )
    assert sum(1 for c, _ in tags if c == "pattern") <= BY_NAME["pattern"].max_tags


def test_single_label_categories_store_one_tag() -> None:
    for category in (c for c in CATEGORIES if c.max_tags == 1):
        tags = stored(
            axis_tagger(), image(**{f"{category.name.value}:{category.labels[0].tag}": 1.0})
        )
        assert sum(1 for c, _ in tags if c == category.name.value) <= 1


def test_categories_are_skipped_where_they_make_no_sense() -> None:
    vector = image(**{"garment:kurta": 1.0, "silhouette:flared": 1.0})
    assert {c for c, _ in stored(axis_tagger(), vector, ItemType.FABRIC.value)}.isdisjoint(
        {"garment", "silhouette"}
    )
    assert "silhouette" not in {
        c for c, _ in stored(axis_tagger(), vector, ItemType.ACCESSORY.value)
    }
    assert {"garment", "silhouette"} <= {c for c, _ in stored(axis_tagger(), vector, None)}


def test_scores_list_every_label_and_agree_with_predict() -> None:
    tagger = axis_tagger()
    vector = image(**{"fabric:silk": 1.0, "craft:kanjeevaram": 1.0})

    scores = tagger.scores(vector)

    assert set(scores) == {c.name.value for c in CATEGORIES}
    for category in CATEGORIES:
        listed = scores[category.name.value]
        assert len(listed) == len(category.labels)
        assert [s.score for s in listed] == sorted((s.score for s in listed), reverse=True)
        assert sum(s.score for s in listed) == pytest.approx(1.0, abs=1e-3)
        assert not any(s.passes for s in listed if s.none)
    passing = {(c, s.tag) for c, labels in scores.items() for s in labels if s.passes}
    assert passing == stored(tagger, vector)


def test_suggested_item_type_needs_a_confident_score() -> None:
    tagger = axis_tagger()
    assert tagger.suggest_type(image(**{"type:fabric": 1.0})) == ItemType.FABRIC
    assert tagger.suggest_type(image(**{"type:fabric": 1.0, "type:garment": 1.0})) is None


# --- the text-vector cache -----------------------------------------------------------------


class CountingEncoder:
    def __init__(self) -> None:
        self.calls = 0

    def __call__(self, texts: list[str]) -> np.ndarray:
        self.calls += 1
        rng = np.random.default_rng(len(texts))
        rows = rng.normal(size=(len(texts), 8))
        return rows / np.linalg.norm(rows, axis=1, keepdims=True)


def test_cache_is_written_once_and_reused(tmp_path: Path) -> None:
    encoder = CountingEncoder()
    first = Tagger.load_or_build(tmp_path, "model-a", encoder, 100.0)
    calls_after_build = encoder.calls

    second = Tagger.load_or_build(tmp_path, "model-a", encoder, 100.0)

    assert calls_after_build > 0 and encoder.calls == calls_after_build  # no re-encoding
    assert [p.name for p in tmp_path.iterdir()] == [f"text-{cache_key('model-a')}.npz"]
    vector = np.ones(8, dtype=np.float32) / np.sqrt(8)
    assert first.scores(vector) == second.scores(vector)


def test_cache_key_covers_model_templates_and_vocabulary(monkeypatch: pytest.MonkeyPatch) -> None:
    base = cache_key("model-a")
    assert cache_key("model-b") != base
    monkeypatch.setattr(vocabulary, "TEMPLATE_VERSION", "pt-next")
    assert cache_key("model-a") != base
    monkeypatch.undo()
    monkeypatch.setattr(vocabulary, "VOCABULARY_HASH", "0000000000")
    assert cache_key("model-a") != base


def test_a_cache_with_mismatched_metadata_is_rebuilt(tmp_path: Path) -> None:
    encoder = CountingEncoder()
    Tagger.load_or_build(tmp_path, "model-a", encoder, 100.0)
    built = encoder.calls

    Tagger.load_or_build(tmp_path, "model-a", encoder, 50.0)  # same key, different logit scale

    assert encoder.calls == 2 * built


def test_an_unreadable_cache_is_rebuilt(tmp_path: Path) -> None:
    (tmp_path / f"text-{cache_key('model-a')}.npz").write_bytes(b"not a numpy file")
    encoder = CountingEncoder()
    Tagger.load_or_build(tmp_path, "model-a", encoder, 100.0)
    assert encoder.calls > 0


def test_tagger_version_names_model_templates_and_vocabulary() -> None:
    version = tagging.tagger_version("open_clip/ViT-B-32/x@1234567/pp1")
    assert version.endswith(f"/{vocabulary.TEMPLATE_VERSION}/v{vocabulary.VOCABULARY_HASH}")
    assert len(tagging.tagger_version("m" * 51)) <= 100  # tags.model_name column width


# --- the vocabulary itself ------------------------------------------------------------------


def test_vocabulary_categories_match_the_database_constraint() -> None:
    assert {c.name.value for c in CATEGORIES} == {c.value for c in TagCategory}


def test_every_vocabulary_tag_is_valid_and_unique() -> None:
    for category in CATEGORIES:
        storable = vocabulary.vocabulary_tags(category.name.value)
        assert len(storable) >= 3
        assert len(storable) == len(set(storable))
        for tag in storable:
            assert validate(TagEdit(category.name.value, tag)).tag == tag
        assert all(label.phrases for label in category.labels)
        assert 0 < category.min_score < 1 and 0 <= category.min_margin < 1


def test_fabric_is_marked_as_a_guess() -> None:
    assert BY_NAME["fabric"].is_guess and not BY_NAME["craft"].is_guess
