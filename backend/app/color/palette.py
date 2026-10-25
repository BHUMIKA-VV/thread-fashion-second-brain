"""Dominant-colour extraction: K-means clustering in CIELAB.

Pipeline: downscale -> keep visible pixels (alpha, optional background mask) -> convert to
LAB -> K-means -> merge near-identical clusters -> percentages -> convert centroids back to
sRGB. Displayed HEX/RGB come from those final sRGB values, so a swatch and the hex a user
copies are always the same colour.

Results are deterministic: fixed random seeds for sampling and K-means.
"""

from dataclasses import dataclass
from typing import Literal

import numpy as np
from PIL import Image
from sklearn.cluster import KMeans

from app.color.lab import delta_e_2000, lab_to_srgb, srgb_to_lab, to_hex
from app.color.naming import family_for_lab, name_for_lab

ANALYSIS_SIDE = 256  # pixels; plenty for colour statistics and fast on CPU
MAX_SAMPLES = 20_000
MERGE_DELTA_E = 6.0  # clusters closer than this look like one colour
MIN_SHARE = 1.0  # percent; smaller clusters are noise rather than a palette colour
SEED = 0

PaletteSource = Literal["original", "masked", "cutout"]


class PaletteError(ValueError):
    """The image cannot yield a palette (e.g. fully transparent)."""


@dataclass(frozen=True)
class PaletteColor:
    hex: str
    rgb: tuple[int, int, int]
    name: str
    family: str
    percentage: float
    lab: tuple[float, float, float]


@dataclass(frozen=True)
class Palette:
    colors: list[PaletteColor]
    source: PaletteSource  # "masked" = plain background detected and excluded


def _analysis_pixels(image: Image.Image) -> np.ndarray:
    """RGBA pixels of a downscaled copy, shape (H, W, 4)."""
    rgba = image.convert("RGBA")
    # NEAREST keeps only colours that really occur; averaging filters invent blended
    # in-between colours along edges, which would show up as fake swatches.
    rgba.thumbnail((ANALYSIS_SIDE, ANALYSIS_SIDE), Image.Resampling.NEAREST)
    return np.asarray(rgba, dtype=np.uint8)


def estimate_background_mask(rgba: np.ndarray) -> np.ndarray | None:
    """Foreground mask for photos on a plain backdrop, or None when not confident.

    If the outer ring of pixels is (almost) one colour, treat pixels that are clearly
    different from it as foreground. Returns None for busy borders, or when the "foreground"
    would be implausibly small or large.
    """
    height, width = rgba.shape[:2]
    if min(height, width) < 16:
        return None
    ring = max(2, min(height, width) // 50)
    border = np.concatenate(
        [
            rgba[:ring].reshape(-1, 4),
            rgba[-ring:].reshape(-1, 4),
            rgba[:, :ring].reshape(-1, 4),
            rgba[:, -ring:].reshape(-1, 4),
        ]
    )
    border = border[border[:, 3] >= 128][:, :3]
    if len(border) == 0:
        return None
    border_lab = srgb_to_lab(border)
    backdrop = np.median(border_lab, axis=0)
    if np.mean(delta_e_2000(border_lab, backdrop) < 8) < 0.85:
        return None  # border is not a uniform backdrop

    pixel_lab = srgb_to_lab(rgba[..., :3].reshape(-1, 3))
    foreground = (delta_e_2000(pixel_lab, backdrop) >= 12).reshape(height, width)
    share = foreground.mean()
    return foreground if 0.05 <= share <= 0.95 else None


def _percentages(counts: np.ndarray) -> list[float]:
    """Shares to one decimal that sum to exactly 100.0 (largest-remainder method)."""
    tenths = counts / counts.sum() * 1000
    floored = np.floor(tenths).astype(int)
    shortfall = 1000 - floored.sum()
    for index in np.argsort(-(tenths - floored), kind="stable")[:shortfall]:
        floored[index] += 1
    return [round(int(value) / 10, 1) for value in floored]


def _merge_close_clusters(centers: np.ndarray, counts: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    order = np.argsort(-counts, kind="stable")
    merged_centers: list[np.ndarray] = []
    merged_counts: list[float] = []
    for index in order:
        center, count = centers[index], float(counts[index])
        for slot, existing in enumerate(merged_centers):
            if delta_e_2000(existing, center) < MERGE_DELTA_E:
                total = merged_counts[slot] + count
                merged_centers[slot] = (existing * merged_counts[slot] + center * count) / total
                merged_counts[slot] = total
                break
        else:
            merged_centers.append(center)
            merged_counts.append(count)
    return np.array(merged_centers), np.array(merged_counts)


def extract_palette(
    image: Image.Image, n_colors: int = 6, *, detect_background: bool = True
) -> Palette:
    if not 1 <= n_colors <= 12:
        raise ValueError("n_colors must be between 1 and 12")

    rgba = _analysis_pixels(image)
    visible = rgba[..., 3] >= 128
    source: PaletteSource = "original"
    if detect_background and visible.all():
        mask = estimate_background_mask(rgba)
        if mask is not None:
            visible = visible & mask
            source = "masked"

    pixels = rgba[..., :3][visible]
    if len(pixels) == 0:
        raise PaletteError("The image has no visible pixels.")
    if len(pixels) > MAX_SAMPLES:
        rng = np.random.default_rng(SEED)
        pixels = pixels[rng.choice(len(pixels), MAX_SAMPLES, replace=False)]

    lab = srgb_to_lab(pixels)
    distinct = len(np.unique(pixels, axis=0))
    k = min(n_colors, distinct)
    if k == 1:
        centers, counts = lab.mean(axis=0, keepdims=True), np.array([len(lab)], dtype=float)
    else:
        model = KMeans(n_clusters=k, n_init=4, random_state=SEED).fit(lab)
        centers = model.cluster_centers_
        counts = np.bincount(model.labels_, minlength=k).astype(float)
        keep = counts > 0
        centers, counts = _merge_close_clusters(centers[keep], counts[keep])
        # Drop slivers (edge noise, specks); the remaining shares are renormalised below.
        significant = counts / counts.sum() * 100 >= MIN_SHARE
        if significant.any():
            centers, counts = centers[significant], counts[significant]

    order = np.argsort(-counts, kind="stable")
    centers, counts = centers[order], counts[order]
    rgb_values = lab_to_srgb(centers)
    # Re-derive LAB from the rounded sRGB so every stored value describes the displayed colour.
    final_lab = srgb_to_lab(rgb_values)
    colors = [
        PaletteColor(
            hex=to_hex(rgb),
            rgb=(int(rgb[0]), int(rgb[1]), int(rgb[2])),
            name=name_for_lab(lab_value),
            family=family_for_lab(lab_value),
            percentage=share,
            lab=(
                round(float(lab_value[0]), 2),
                round(float(lab_value[1]), 2),
                round(float(lab_value[2]), 2),
            ),
        )
        for rgb, lab_value, share in zip(rgb_values, final_lab, _percentages(counts), strict=True)
    ]
    return Palette(colors=colors, source=source)
