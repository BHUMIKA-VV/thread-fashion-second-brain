"""A board's colour story, from stored palettes and the colours the owner chose. No model.

- measured   the relationships across the board's pieces, exactly as for an outfit
             (app/color/outfit.py): dominant, shared, complementary and contrasting colours.
             A piece placed twice counts once.
- chosen     each colour block, named like a measured colour, with the nearest colour actually
             measured on the board's pieces (CIEDE2000, swatches of 5% or more). It is "on the
             pieces" when that distance is within the merge distance used for dominant colours.
- harmony    the existing harmony rule (app/color/harmony.py) over the dominant measured
             colours, at their shares, and the chosen colours, each counted as clearly present.
"""

from collections.abc import Hashable, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np

from app.color.harmony import MIN_SHARE, detect_harmony
from app.color.lab import delta_e_2000, from_hex, srgb_to_lab
from app.color.naming import family_for_lab, name_for_lab
from app.color.outfit import MERGE_DELTA_E, OutfitColours, outfit_colours
from app.models.enums import Harmony

# A chosen colour is a deliberate decision, so it counts as clearly present in the harmony rule.
CHOSEN_SHARE = 2 * MIN_SHARE


@dataclass(frozen=True)
class NearestSwatch:
    hex: str
    name: str
    item_id: Hashable
    distance: float


@dataclass(frozen=True)
class ChosenColour:
    block_id: Hashable
    hex: str
    name: str
    family: str
    nearest: NearestSwatch | None
    on_pieces: bool


@dataclass(frozen=True)
class ColourStory:
    measured: OutfitColours
    chosen: list[ChosenColour]
    harmony: Harmony | None  # None when the board has no colour at all


def _lab(hex_value: str) -> np.ndarray:
    return srgb_to_lab(np.array(from_hex(hex_value), dtype=np.float64))


def colour_story(
    pieces: Sequence[tuple[Hashable, Sequence[dict[str, Any]] | None]],
    chosen: Sequence[tuple[Hashable, str]],
) -> ColourStory:
    """`pieces` is (item id, stored palette colours or None) in board order; `chosen` is
    (block id, hex) for each colour block in board order."""
    seen: set[Hashable] = set()
    unique = []
    for item_id, colours in pieces:
        if item_id not in seen:
            seen.add(item_id)
            unique.append((item_id, colours))
    measured = outfit_colours(unique)

    swatches = [
        (item_id, swatch)
        for item_id, colours in unique
        for swatch in colours or []
        if float(swatch["percentage"]) >= MIN_SHARE
    ]
    swatch_labs = np.array([s["lab"] for _, s in swatches], dtype=np.float64).reshape(-1, 3)

    story: list[ChosenColour] = []
    for block_id, hex_value in chosen:
        lab = _lab(hex_value)
        nearest = None
        if len(swatches):
            distances = delta_e_2000(lab[None, :], swatch_labs)
            index = int(np.argmin(distances))
            item_id, swatch = swatches[index]
            nearest = NearestSwatch(
                swatch["hex"], swatch["name"], item_id, round(float(distances[index]), 1)
            )
        story.append(
            ChosenColour(
                block_id,
                hex_value,
                name_for_lab(lab),
                family_for_lab(lab),
                nearest,
                nearest is not None and nearest.distance <= MERGE_DELTA_E,
            )
        )

    dominant_labs = {
        s["hex"]: s["lab"] for _, colours in unique for s in colours or []
    }  # dominant colours are named after one of the measured swatches
    harmony_input = [
        (tuple(dominant_labs[c.hex]), c.share) for c in measured.dominant if c.hex in dominant_labs
    ] + [(tuple(_lab(c.hex)), CHOSEN_SHARE) for c in story]
    harmony = detect_harmony(harmony_input) if harmony_input else None
    return ColourStory(measured, story, harmony)
