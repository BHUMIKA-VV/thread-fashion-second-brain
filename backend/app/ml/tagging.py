"""Zero-shot fashion tagging from stored image embeddings (see vocabulary.py for the rules).

Text vectors for every vocabulary prompt are computed once and cached on disk. The cache key
covers the image/text model identifier, the prompt-template version and the vocabulary hash;
the same metadata is stored in the file and re-checked on load, so vectors from a different
model, template or vocabulary are never reused.
"""

import hashlib
import json
import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from app.ml import model_spec, vocabulary
from app.ml.vocabulary import CATEGORIES, ITEM_TYPE_LABELS, TEMPLATES, Category, Label
from app.models.enums import ItemType

logger = logging.getLogger(__name__)

Matrix = NDArray[np.float32]
TextEncoder = Callable[[Sequence[str]], Matrix]  # prompts -> L2-normalised rows


@dataclass(frozen=True)
class Prediction:
    category: str
    tag: str
    score: float  # softmax within the category: relative, uncalibrated


@dataclass(frozen=True)
class LabelScore:
    tag: str
    score: float
    none: bool
    passes: bool  # would be stored as an AI tag


def tagger_version(model_name: str) -> str:
    """Stored in tags.model_name for AI rows; changes when model, prompts or vocabulary do."""
    return f"{model_name}/{vocabulary.TEMPLATE_VERSION}/v{vocabulary.VOCABULARY_HASH}"


def cache_key(model_name: str) -> str:
    raw = f"{model_name}|{vocabulary.TEMPLATE_VERSION}|{vocabulary.VOCABULARY_HASH}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _normalise_rows(matrix: NDArray[np.floating]) -> Matrix:
    matrix = np.asarray(matrix, dtype=np.float32)
    return matrix / np.linalg.norm(matrix, axis=1, keepdims=True)


def _label_matrix(labels: Sequence[Label], encode: TextEncoder) -> Matrix:
    rows = []
    for label in labels:
        prompts = [template.format(phrase) for phrase in label.phrases for template in TEMPLATES]
        rows.append(encode(prompts).mean(axis=0))  # prompt ensemble
    return _normalise_rows(np.stack(rows))


class Tagger:
    def __init__(
        self,
        model_name: str,
        category_matrices: dict[str, Matrix],
        item_type_matrix: Matrix,
        logit_scale: float = 100.0,
    ) -> None:
        self.model_name = model_name
        self.version = tagger_version(model_name)
        self.logit_scale = logit_scale
        self._category_matrices = category_matrices
        self._item_type_matrix = item_type_matrix

    # --- construction --------------------------------------------------------------------

    @classmethod
    def build(cls, model_name: str, encode: TextEncoder, logit_scale: float) -> "Tagger":
        matrices = {c.name.value: _label_matrix(c.labels, encode) for c in CATEGORIES}
        item_types = _normalise_rows(
            np.stack(
                [encode([t.format(p) for t in TEMPLATES]).mean(axis=0) for _, p in ITEM_TYPE_LABELS]
            )
        )
        return cls(model_name, matrices, item_types, logit_scale)

    @classmethod
    def load_or_build(
        cls, cache_dir: Path, model_name: str, encode: TextEncoder, logit_scale: float
    ) -> "Tagger":
        path = cache_dir / f"text-{cache_key(model_name)}.npz"
        meta = {
            "model": model_name,
            "templates": vocabulary.TEMPLATE_VERSION,
            "vocabulary": vocabulary.VOCABULARY_HASH,
            "logit_scale": logit_scale,
        }
        if path.is_file():
            try:
                with np.load(path, allow_pickle=False) as data:
                    if json.loads(str(data["meta"])) == meta:
                        matrices = {c.name.value: data[f"cat_{c.name.value}"] for c in CATEGORIES}
                        logger.info("Loaded cached text vectors %s", path.name)
                        return cls(model_name, matrices, data["item_types"], logit_scale)
                logger.warning("Text-vector cache %s does not match; rebuilding", path.name)
            except (OSError, KeyError, ValueError):
                logger.warning("Text-vector cache %s is unreadable; rebuilding", path.name)
        tagger = cls.build(model_name, encode, logit_scale)
        cache_dir.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp.npz")
        np.savez(
            tmp,
            meta=np.array(json.dumps(meta)),
            item_types=tagger._item_type_matrix,
            **{f"cat_{k}": v for k, v in tagger._category_matrices.items()},
        )
        tmp.replace(path)
        return tagger

    # --- scoring -------------------------------------------------------------------------

    def _softmax(self, matrix: Matrix, vector: NDArray[np.floating]) -> NDArray[np.float64]:
        logits = self.logit_scale * (
            matrix.astype(np.float64) @ np.asarray(vector, dtype=np.float64)
        )
        logits -= logits.max()
        weights = np.exp(logits)
        return weights / weights.sum()

    def scores(
        self, vector: NDArray[np.floating], item_type: str | None = None
    ) -> dict[str, list[LabelScore]]:
        """Every label's score per category (sorted), marking which would be stored."""
        result: dict[str, list[LabelScore]] = {}
        for category in CATEGORIES:
            if item_type is not None and item_type in category.skip_for:
                continue
            probabilities = self._softmax(self._category_matrices[category.name.value], vector)
            ranked = sorted(zip(category.labels, probabilities, strict=True), key=lambda p: -p[1])
            stored = {p.tag for p in _select(category, ranked)}
            result[category.name.value] = [
                LabelScore(
                    label.tag,
                    round(float(score), 4),
                    label.none,
                    label.tag in stored and not label.none,
                )
                for label, score in ranked
            ]
        return result

    def predict(
        self, vector: NDArray[np.floating], item_type: str | None = None
    ) -> list[Prediction]:
        predictions: list[Prediction] = []
        for category in CATEGORIES:
            if item_type is not None and item_type in category.skip_for:
                continue
            probabilities = self._softmax(self._category_matrices[category.name.value], vector)
            ranked = sorted(zip(category.labels, probabilities, strict=True), key=lambda p: -p[1])
            predictions.extend(_select(category, ranked))
        return predictions

    def suggest_type(self, vector: NDArray[np.floating]) -> ItemType | None:
        probabilities = self._softmax(self._item_type_matrix, vector)
        best = int(np.argmax(probabilities))
        return (
            ITEM_TYPE_LABELS[best][0]
            if probabilities[best] >= vocabulary.ITEM_TYPE_MIN_SCORE
            else None
        )


def _select(category: Category, ranked: list[tuple[Label, np.floating]]) -> list[Prediction]:
    """Apply the conservative rules: confident top label with a clear margin, then optional
    extra labels (multi-label categories) that clear the minimum score. "None" labels stop it."""
    top_label, top_score = ranked[0]
    runner_up = float(ranked[1][1]) if len(ranked) > 1 else 0.0
    if (
        top_label.none
        or top_score < category.min_score
        or top_score - runner_up < category.min_margin
    ):
        return []
    chosen = [Prediction(category.name.value, top_label.tag, round(float(top_score), 4))]
    for label, score in ranked[1:]:
        if len(chosen) >= category.max_tags or score < category.min_score:
            break
        if label.none:
            break  # "none of these" outranks the rest: stop adding
        chosen.append(Prediction(category.name.value, label.tag, round(float(score), 4)))
    return chosen


def text_cache_dir(cache_root: Path) -> Path:
    return cache_root / "text" / model_spec.ARCHITECTURE
