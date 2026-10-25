"""Human-readable colour names, kept separate from extraction so naming can improve on its own.

A colour gets the name of the nearest reference colour by CIEDE2000. References are the
xkcd colour survey (CC0, ~950 names chosen by real people) plus a curated Indian vocabulary
(haldi yellow, sindoor red, mehendi green, ...). The lookup is deterministic: ties are broken
by list order, with the Indian vocabulary listed first.
"""

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
from numpy.typing import ArrayLike

from app.color.lab import delta_e_2000, from_hex, lab_to_lch, srgb_to_lab

DATA_DIR = Path(__file__).parent / "data"


@dataclass(frozen=True)
class ColorNames:
    names: tuple[str, ...]
    sources: tuple[str, ...]
    lab: np.ndarray


def _load(file: str) -> list[tuple[str, str]]:
    with (DATA_DIR / file).open(encoding="utf-8") as handle:
        return [(name, hex_value) for name, hex_value in json.load(handle)["colors"]]


@lru_cache
def reference_names() -> ColorNames:
    indian = [(n, h, "indian") for n, h in _load("indian_colors.json")]
    xkcd = [(n, h, "xkcd") for n, h in _load("xkcd_colors.json")]
    entries = indian + xkcd
    rgb = np.array([from_hex(h) for _, h, _ in entries], dtype=np.float64)
    return ColorNames(
        names=tuple(n for n, _, _ in entries),
        sources=tuple(s for _, _, s in entries),
        lab=srgb_to_lab(rgb),
    )


def name_for_lab(lab: ArrayLike) -> str:
    refs = reference_names()
    distances = delta_e_2000(np.asarray(lab, dtype=np.float64)[None, :], refs.lab)
    return refs.names[int(np.argmin(distances))]  # argmin returns the first minimum


def name_for_rgb(rgb: ArrayLike) -> str:
    return name_for_lab(srgb_to_lab(np.asarray(rgb, dtype=np.float64)))


# Coarse families used for filtering ("show me everything blue"). Hue ranges are in LCh degrees.
# Boundaries were calibrated against reference colours, e.g. crimson 25°, orange 64°,
# yellow 103°, green 136°, teal 196°, denim 284°, sRGB blue 306°, purple 328°, hot pink 351°.
_HUE_FAMILIES = (
    (22.0, "pink"),
    (50.0, "red"),
    (80.0, "orange"),
    (105.0, "yellow"),
    (170.0, "green"),
    (225.0, "teal"),
    (312.0, "blue"),
    (340.0, "purple"),
    (360.0, "pink"),
)
FAMILIES = (
    "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink",
    "brown", "beige", "white", "grey", "black",
)  # fmt: skip


def family_for_lab(lab: ArrayLike) -> str:
    lightness, chroma, hue = (float(v) for v in lab_to_lch(lab))
    if chroma < 10:
        if lightness >= 88:
            return "white"
        if lightness <= 22:
            return "black"
        # Warm, light, low-chroma colours read as beige rather than grey.
        return "beige" if lightness >= 60 and chroma >= 5 and 40 <= hue <= 110 else "grey"
    if 30 <= hue <= 95 and lightness < 55 and chroma < 60:
        return "brown"
    if 40 <= hue <= 115 and lightness >= 70 and chroma < 25:
        return "beige"
    return next(family for limit, family in _HUE_FAMILIES if hue < limit)
