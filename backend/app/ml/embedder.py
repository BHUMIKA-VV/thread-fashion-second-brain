"""Image embeddings with OpenCLIP ViT-B/32.

Preprocessing version "pp1" (identical for indexing and search, because search reuses the
stored vector of the query item):

1. Apply transparency: composite RGBA/LA/P-with-alpha onto white, then convert to RGB.
2. OpenCLIP's own eval transform for this checkpoint: resize the shorter side to 224 px
   (bicubic), centre-crop 224x224, scale to [0, 1], normalise with CLIP's mean
   (0.48145466, 0.4578275, 0.40821073) and std (0.26862954, 0.26130258, 0.27577711).
3. encode_image in float32 on CPU, then L2-normalise, so cosine similarity = dot product
   and pgvector's cosine distance = 1 - similarity.
"""

import logging
import threading
from pathlib import Path
from typing import Protocol

import numpy as np
from numpy.typing import NDArray
from PIL import Image

from app.ml import model_spec

logger = logging.getLogger(__name__)

Vector = NDArray[np.float32]


class EmbeddingError(RuntimeError):
    """Embedding a specific image failed."""


class Embedder(Protocol):
    model_name: str
    dimension: int
    logit_scale: float  # CLIP's learned temperature for image-text similarity

    def embed(self, image: Image.Image) -> Vector:
        """Unit-length float32 vector of length `dimension`."""

    def encode_texts(self, texts: list[str]) -> NDArray[np.float32]:
        """Unit-length text vectors (one row per text) in the same space as `embed`."""


def to_rgb_on_white(image: Image.Image) -> Image.Image:
    """Step 1 of pp1: flatten transparency onto white and return an RGB image."""
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        canvas = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        return Image.alpha_composite(canvas, rgba).convert("RGB")
    return image.convert("RGB")


def l2_normalise(vector: NDArray[np.floating]) -> Vector:
    vector = np.asarray(vector, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(vector))
    if not np.isfinite(norm) or norm == 0.0:
        raise EmbeddingError("The model produced an empty or invalid vector.")
    return (vector / norm).astype(np.float32)


class OpenClipEmbedder:
    """Loads the pinned checkpoint from a local file. Never touches the network."""

    model_name = model_spec.MODEL_NAME
    dimension = model_spec.DIMENSION

    def __init__(self, weights: Path, *, threads: int = 4) -> None:
        import open_clip  # heavy import: only when the model is actually loaded
        import torch

        torch.set_num_threads(threads)  # leave CPU for the web server and palette work
        # `pretrained` as a local file path: open_clip loads it directly, no download.
        model, _, preprocess = open_clip.create_model_and_transforms(
            model_spec.ARCHITECTURE, pretrained=str(weights), device="cpu"
        )
        model.eval()
        self._torch = torch
        self._model = model
        self._preprocess = preprocess
        # The tokenizer's BPE vocabulary ships inside the open_clip package: no download.
        self._tokenizer = open_clip.get_tokenizer(model_spec.ARCHITECTURE)
        self.logit_scale = float(model.logit_scale.detach().exp())
        self._lock = threading.Lock()  # torch modules are not guaranteed thread-safe

        produced = self._encode(Image.new("RGB", (224, 224), (128, 128, 128))).shape[0]
        if produced != self.dimension:
            raise EmbeddingError(
                f"Model produces {produced}-dimensional vectors; the database expects "
                f"{self.dimension}."
            )

    def _encode(self, image: Image.Image) -> NDArray[np.float32]:
        tensor = self._preprocess(to_rgb_on_white(image)).unsqueeze(0)
        with self._lock, self._torch.inference_mode():
            features = self._model.encode_image(tensor)
        return features[0].float().numpy()

    def embed(self, image: Image.Image) -> Vector:
        try:
            raw = self._encode(image)
        except Exception as exc:
            raise EmbeddingError("The image could not be embedded.") from exc
        return l2_normalise(raw)

    def encode_texts(self, texts: list[str]) -> NDArray[np.float32]:
        tokens = self._tokenizer(list(texts))
        with self._lock, self._torch.inference_mode():
            features = self._model.encode_text(tokens).float().numpy()
        return features / np.linalg.norm(features, axis=1, keepdims=True)
