"""The one image-embedding model Thread uses, pinned exactly.

Stored vectors are only comparable when they come from the same weights AND the same
preprocessing. Every embedding row records MODEL_NAME; similarity search only compares rows
with the current MODEL_NAME. If anything below changes (architecture, checkpoint, revision,
preprocessing or normalisation), bump MODEL_NAME and re-index.
"""

from pathlib import Path

from app.models.embedding import EMBEDDING_DIM

ARCHITECTURE = "ViT-B-32"
PRETRAINED_TAG = "laion2b_s34b_b79k"

HF_REPO = "laion/CLIP-ViT-B-32-laion2B-s34B-b79K"
HF_REVISION = "1a25a446712ba5ee05982a381eed697ef9b435cf"  # pinned commit, not "main"
WEIGHTS_FILE = "open_clip_model.safetensors"
WEIGHTS_SHA256 = "ac4f8c4b88af6d963118cbf40ad93176d092abbedfcb752601ae1866352656e6"
WEIGHTS_BYTES = 605_143_316

# Identifier stored with every vector. "pp1" = preprocessing version 1 (see embedder.py).
MODEL_NAME = f"open_clip/{ARCHITECTURE}/{PRETRAINED_TAG}@{HF_REVISION[:7]}/pp1"

DIMENSION = EMBEDDING_DIM  # 512, verified against the loaded model before any vector is stored


def weights_path(cache_root: Path) -> Path:
    return cache_root / f"{ARCHITECTURE}-{PRETRAINED_TAG}" / WEIGHTS_FILE
