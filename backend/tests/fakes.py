"""Test doubles for the image model."""

import numpy as np
from PIL import Image

from app.ml.embedder import EmbeddingError, Vector, l2_normalise, to_rgb_on_white
from app.models import EMBEDDING_DIM


class FakeEmbedder:
    """Deterministic stand-in for OpenCLIP: a vector built from an 8x8 colour thumbnail.

    Images with similar colour layouts get similar vectors, which is enough to test ranking,
    ownership and storage without the real model.
    """

    model_name = "fake/colour-layout/pp1"
    dimension = EMBEDDING_DIM

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
