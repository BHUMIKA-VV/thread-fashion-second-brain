"""Heuristic colour-harmony label for a palette.

This is a rule of thumb, not a measurement. It looks only at clearly coloured swatches
(chroma >= 12 and >= 5% of the image) and compares their hue angles in LCh space:

- neutral        no clearly coloured swatches (greys, whites, blacks, beiges)
- monochromatic  all coloured swatches within a 30° hue arc (shades of one hue)
- analogous      all within a 75° arc (neighbours on the colour wheel)
- complementary  two tight hue groups roughly opposite each other (150°-210° apart)
- mixed          anything else
"""

from collections.abc import Sequence

import numpy as np

from app.color.lab import lab_to_lch
from app.models.enums import Harmony

MIN_CHROMA = 12.0
MIN_SHARE = 5.0


def _arc_span(hues: np.ndarray) -> float:
    """Smallest arc (degrees) of the hue circle that contains every hue."""
    if len(hues) <= 1:
        return 0.0
    ordered = np.sort(hues)
    gaps = np.diff(np.concatenate([ordered, [ordered[0] + 360]]))
    return float(360 - gaps.max())


def _circular_mean(hues: np.ndarray, weights: np.ndarray) -> float:
    radians = np.radians(hues)
    return float(
        np.degrees(np.arctan2(np.sum(weights * np.sin(radians)), np.sum(weights * np.cos(radians))))
        % 360
    )


def detect_harmony(colors: Sequence[tuple[tuple[float, float, float], float]]) -> Harmony:
    """`colors` is a sequence of (lab, percentage)."""
    lch = lab_to_lch(np.array([lab for lab, _ in colors], dtype=float))
    shares = np.array([share for _, share in colors], dtype=float)
    chromatic = (lch[:, 1] >= MIN_CHROMA) & (shares >= MIN_SHARE)
    hues, weights = lch[chromatic, 2], shares[chromatic]

    if len(hues) == 0:
        return Harmony.NEUTRAL
    span = _arc_span(hues)
    if span <= 30:
        return Harmony.MONOCHROMATIC
    if span <= 75:
        return Harmony.ANALOGOUS

    # Split the circle at its two largest gaps into two groups and test for opposition.
    order = np.argsort(hues)
    sorted_hues, sorted_weights = hues[order], weights[order]
    gaps = np.diff(np.concatenate([sorted_hues, [sorted_hues[0] + 360]]))
    cut_a, cut_b = sorted(np.argsort(gaps)[-2:])
    group_one = np.arange(cut_a + 1, cut_b + 1)
    group_two = np.setdiff1d(np.arange(len(sorted_hues)), group_one)
    if len(group_one) and len(group_two):
        tight = all(_arc_span(sorted_hues[g]) <= 45 for g in (group_one, group_two))
        mean_one = _circular_mean(sorted_hues[group_one], sorted_weights[group_one])
        mean_two = _circular_mean(sorted_hues[group_two], sorted_weights[group_two])
        separation = abs((mean_one - mean_two + 180) % 360 - 180)
        if tight and 150 <= separation <= 210:
            return Harmony.COMPLEMENTARY
    return Harmony.MIXED
