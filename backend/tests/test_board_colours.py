"""A board's colour story: measured relationships across its pieces, each chosen colour checked
against what was measured, and a harmony label, all from stored data."""

from typing import Any

import numpy as np

from app.color.board import colour_story
from app.color.lab import from_hex, srgb_to_lab
from app.models.enums import Harmony


def swatch(hex_value: str, share: float, name: str = "x") -> dict[str, Any]:
    lab = srgb_to_lab(np.array(from_hex(hex_value), dtype=np.float64))
    return {"hex": hex_value, "name": name, "percentage": share, "lab": [float(v) for v in lab]}


RED = swatch("#c0282d", 70, "red")
CREAM = swatch("#f2e8d5", 30, "cream")
INDIGO = swatch("#263b5e", 80, "indigo")


def test_an_empty_board_has_no_story() -> None:
    story = colour_story([], [])
    assert (story.measured.dominant, story.chosen, story.harmony) == ([], [], None)


def test_measured_colours_count_a_repeated_piece_once() -> None:
    once = colour_story([("a", [RED, CREAM]), ("b", [INDIGO])], [])
    twice = colour_story([("a", [RED, CREAM]), ("b", [INDIGO]), ("a", [RED, CREAM])], [])
    assert twice.measured == once.measured
    assert once.measured.pieces_with_palette == 2
    assert [c.hex for c in once.measured.dominant] == ["#263b5e", "#c0282d", "#f2e8d5"]


def test_chosen_colours_are_named_and_matched_to_measured_ones() -> None:
    story = colour_story(
        [("a", [RED, CREAM]), ("b", None)],
        [("near", "#c22a2f"), ("far", "#1f7a3a")],
    )
    near, far = story.chosen
    assert (near.block_id, near.hex, near.family) == ("near", "#c22a2f", "red")
    assert near.nearest is not None and (near.nearest.hex, near.nearest.item_id) == ("#c0282d", "a")
    assert near.nearest.distance < 2 and near.on_pieces is True
    assert far.family == "green"
    assert far.nearest is not None and far.nearest.distance > 10 and far.on_pieces is False
    assert story.measured.pieces_without_palette == 1


def test_a_chosen_colour_with_no_measured_pieces_has_no_match() -> None:
    story = colour_story([("a", None)], [("c", "#263b5e")])
    (only,) = story.chosen
    assert (only.name, only.nearest, only.on_pieces) == ("neel indigo", None, False)
    assert story.harmony == Harmony.MONOCHROMATIC  # one clear hue


def test_small_swatches_are_never_matched() -> None:
    tiny = swatch("#1f7a3a", 3, "green")
    story = colour_story([("a", [RED, tiny])], [("c", "#1f7a3a")])
    assert story.chosen[0].nearest is not None and story.chosen[0].nearest.hex == "#c0282d"


def test_harmony_takes_both_measured_and_chosen_colours() -> None:
    measured_only = colour_story([("a", [swatch("#c0282d", 100)])], [])
    assert measured_only.harmony == Harmony.MONOCHROMATIC
    # A chosen teal opposite the measured red makes the board complementary.
    with_teal = colour_story([("a", [swatch("#c0282d", 100)])], [("c", "#1f8a8a")])
    assert with_teal.harmony == Harmony.COMPLEMENTARY
    neutral = colour_story([("a", [swatch("#808080", 100)])], [("c", "#f5f5f5")])
    assert neutral.harmony == Harmony.NEUTRAL
