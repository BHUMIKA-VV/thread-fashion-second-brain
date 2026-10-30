"""Visual colour relationships across the pieces of an outfit, from stored palettes only.

These describe how colours sit together; they are not fashion rules. Everything comes from each
piece's measured palette, and only swatches covering at least 5% of a piece are considered:

- dominant       colours (merged across pieces when within a CIEDE2000 distance of 10), ranked
                 by their average share over the pieces that have a palette
- shared         a merged colour that appears in two or more pieces
- complementary  two clearly coloured swatches (chroma >= 12) from different pieces whose hues
                 are 150-210 degrees apart, the same opposition rule as harmony.py
- contrasting    two swatches from different pieces whose CIELAB lightness differs by 40 or more
"""

from collections.abc import Hashable, Sequence
from dataclasses import dataclass
from itertools import combinations
from typing import Any

import numpy as np

from app.color.harmony import MIN_CHROMA, MIN_SHARE
from app.color.lab import delta_e_2000, lab_to_lch

MERGE_DELTA_E = 10.0
MIN_LIGHTNESS_GAP = 40.0
COMPLEMENT_MIN_DEGREES = 150.0
MAX_DOMINANT = 6
MAX_PAIRS = 6


@dataclass(frozen=True)
class OutfitColour:
    hex: str
    name: str
    share: float  # average percentage across the pieces that have a palette
    item_ids: tuple[Hashable, ...]


@dataclass(frozen=True)
class OutfitColours:
    dominant: list[OutfitColour]
    shared: list[OutfitColour]
    complementary: list[tuple[OutfitColour, OutfitColour]]
    contrasting: list[tuple[OutfitColour, OutfitColour]]
    pieces_with_palette: int
    pieces_without_palette: int


@dataclass
class _Group:
    lab: np.ndarray
    hex: str
    name: str
    best_share: float
    total_share: float
    item_ids: list[Hashable]

    def add(self, swatch: dict[str, Any], item_id: Hashable) -> None:
        share = float(swatch["percentage"])
        self.total_share += share
        if item_id not in self.item_ids:
            self.item_ids.append(item_id)
        if share > self.best_share:
            self.lab = np.asarray(swatch["lab"], dtype=float)
            self.hex, self.name, self.best_share = swatch["hex"], swatch["name"], share


def _merge(pieces: Sequence[tuple[Hashable, Sequence[dict[str, Any]]]]) -> list[_Group]:
    """Merge swatches, largest first, so a group is named after its most prominent member."""
    swatches = [
        (swatch, item_id)
        for item_id, colours in pieces
        for swatch in colours
        if float(swatch["percentage"]) >= MIN_SHARE
    ]
    swatches.sort(key=lambda entry: (-float(entry[0]["percentage"]), entry[0]["hex"]))
    groups: list[_Group] = []
    for swatch, item_id in swatches:
        lab = np.asarray(swatch["lab"], dtype=float)
        match = next(
            (g for g in groups if float(delta_e_2000(g.lab, lab)) <= MERGE_DELTA_E),
            None,
        )
        if match is None:
            match = _Group(lab, swatch["hex"], swatch["name"], 0.0, 0.0, [])
            groups.append(match)
        match.add(swatch, item_id)
    return groups


def _different_pieces(a: _Group, b: _Group) -> bool:
    """True when the two colours can be seen on two separate pieces."""
    return len({*a.item_ids, *b.item_ids}) >= 2


def _hue_gap(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


def outfit_colours(
    pieces: Sequence[tuple[Hashable, Sequence[dict[str, Any]] | None]],
) -> OutfitColours:
    """`pieces` is (item id, stored palette colours or None), in display order."""
    with_palette = [(item_id, colours) for item_id, colours in pieces if colours]
    count = len(with_palette)
    groups = _merge(with_palette)

    def public(group: _Group) -> OutfitColour:
        return OutfitColour(
            group.hex, group.name, round(group.total_share / count, 1), tuple(group.item_ids)
        )

    ranked = sorted(groups, key=lambda g: (-g.total_share, g.hex))

    complementary: list[tuple[float, _Group, _Group]] = []
    contrasting: list[tuple[float, _Group, _Group]] = []
    for a, b in combinations(ranked, 2):
        if not _different_pieces(a, b):
            continue
        weight = a.total_share + b.total_share
        lch_a, lch_b = lab_to_lch(a.lab), lab_to_lch(b.lab)
        if (
            lch_a[1] >= MIN_CHROMA
            and lch_b[1] >= MIN_CHROMA
            and _hue_gap(lch_a[2], lch_b[2]) >= COMPLEMENT_MIN_DEGREES
        ):
            complementary.append((weight, a, b))
        if abs(lch_a[0] - lch_b[0]) >= MIN_LIGHTNESS_GAP:
            contrasting.append((weight, a, b))

    def top_pairs(
        pairs: list[tuple[float, _Group, _Group]],
    ) -> list[tuple[OutfitColour, OutfitColour]]:
        pairs.sort(key=lambda p: (-p[0], p[1].hex, p[2].hex))
        return [(public(a), public(b)) for _, a, b in pairs[:MAX_PAIRS]]

    return OutfitColours(
        dominant=[public(g) for g in ranked[:MAX_DOMINANT]],
        shared=[public(g) for g in ranked if len(g.item_ids) >= 2],
        complementary=top_pairs(complementary),
        contrasting=top_pairs(contrasting),
        pieces_with_palette=count,
        pieces_without_palette=len(pieces) - count,
    )
