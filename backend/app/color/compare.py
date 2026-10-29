"""Compare two palettes perceptually.

palette_distance is a share-weighted CIEDE2000 "nearest colour" distance, symmetrised:

    d(A -> B) = sum over colours a in A of  share(a) * min over b in B of  dE2000(a, b)
    distance  = (d(A -> B) + d(B -> A)) / 2

Each colour is matched to the closest colour of the other palette, weighted by how much of
the image it covers, in both directions (so a small accent in one palette cannot be ignored
just because the other palette lacks it, and vice versa). Units are CIEDE2000: about 1 is
barely noticeable, ~5 a clear difference, 20+ clearly different colours.

This is a cheap approximation of an earth mover's distance; it does not require shares to be
moved exactly, which suits approximate palettes.
"""

from collections.abc import Sequence
from typing import Any

import numpy as np

from app.color.lab import delta_e_2000


def _lab_and_weights(colors: Sequence[dict[str, Any]]) -> tuple[np.ndarray, np.ndarray]:
    lab = np.array([c["lab"] for c in colors], dtype=np.float64)
    weights = np.array([float(c["percentage"]) for c in colors], dtype=np.float64)
    return lab, weights / weights.sum()


def palette_distance(a: Sequence[dict[str, Any]], b: Sequence[dict[str, Any]]) -> float:
    if not a or not b:
        raise ValueError("Both palettes need at least one colour.")
    lab_a, w_a = _lab_and_weights(a)
    lab_b, w_b = _lab_and_weights(b)
    pairwise = delta_e_2000(lab_a[:, None, :], lab_b[None, :, :])  # (len a, len b)
    a_to_b = float(np.sum(w_a * pairwise.min(axis=1)))
    b_to_a = float(np.sum(w_b * pairwise.min(axis=0)))
    return round((a_to_b + b_to_a) / 2, 2)


def dominant_family(colors: Sequence[dict[str, Any]]) -> str | None:
    """Family of the largest colour (palettes are stored largest first)."""
    return str(colors[0]["family"]) if colors else None
