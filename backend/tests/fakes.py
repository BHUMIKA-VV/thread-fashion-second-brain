"""Test doubles for the image model."""

import hashlib
from functools import lru_cache

import numpy as np
from PIL import Image

from app.ml.embedder import EmbeddingError, Vector, l2_normalise, to_rgb_on_white
from app.ml.tagging import Tagger
from app.models import EMBEDDING_DIM


class FakeEmbedder:
    """Deterministic stand-in for OpenCLIP: a vector built from an 8x8 colour thumbnail.

    Images with similar colour layouts get similar vectors, which is enough to test ranking,
    ownership and storage without the real model.
    """

    model_name = "fake/colour-layout/pp1"
    dimension = EMBEDDING_DIM
    logit_scale = 100.0

    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.calls = 0

    def embed(self, image: Image.Image) -> Vector:
        self.calls += 1
        if self.fail:
            raise EmbeddingError("The image could not be embedded.")
        small = to_rgb_on_white(image).resize((8, 8), Image.Resampling.BILINEAR)
        features = np.asarray(small, dtype=np.float32).reshape(-1) / 255.0 - 0.5  # 192 values
        return l2_normalise(np.resize(features, EMBEDDING_DIM))

    def encode_texts(self, texts: list[str]) -> np.ndarray:
        """A fixed pseudo-random unit vector per text (deterministic across runs)."""
        rows = []
        for text in texts:
            seed = int.from_bytes(hashlib.sha256(text.encode()).digest()[:8], "big")
            rows.append(l2_normalise(np.random.default_rng(seed).normal(size=EMBEDDING_DIM)))
        return np.stack(rows)


@lru_cache
def fake_tagger() -> Tagger:
    fake = FakeEmbedder()
    return Tagger.build(fake.model_name, fake.encode_texts, fake.logit_scale)
