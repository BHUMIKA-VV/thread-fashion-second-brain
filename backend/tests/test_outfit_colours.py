"""Colour relationships across an outfit's pieces: calculated from palettes, nothing invented."""

from typing import Any

from app.color.lab import srgb_to_lab
from app.color.outfit import outfit_colours


def swatch(rgb: tuple[int, int, int], share: float, name: str = "colour") -> dict[str, Any]:
    return {
        "hex": "#{:02x}{:02x}{:02x}".format(*rgb),
        "name": name,
        "percentage": share,
        "lab": [float(v) for v in srgb_to_lab(rgb)],
    }


RED = (200, 30, 40)
ALMOST_RED = (204, 34, 44)
TEAL = (0, 150, 160)
IVORY = (240, 235, 220)
CHARCOAL = (40, 40, 42)
GREY = (128, 128, 128)
PALE_GREY = (150, 150, 150)


def test_no_pieces_and_no_palettes_invent_nothing() -> None:
    for pieces in ([], [("a", None), ("b", [])]):
        result = outfit_colours(pieces)
        assert result.dominant == result.shared == []
        assert result.complementary == result.contrasting == []
        assert result.pieces_with_palette == 0
    assert outfit_colours([("a", None), ("b", [])]).pieces_without_palette == 2


def test_dominant_is_ranked_by_average_share_over_pieces_with_a_palette() -> None:
    result = outfit_colours(
        [
            ("a", [swatch(RED, 80, "red"), swatch(IVORY, 20, "ivory")]),
            ("b", [swatch(IVORY, 100, "ivory")]),
            ("c", None),  # no palette: not counted in the average
        ]
    )
    assert [(c.name, c.share) for c in result.dominant] == [("ivory", 60.0), ("red", 40.0)]
    assert (result.pieces_with_palette, result.pieces_without_palette) == (2, 1)


def test_shared_needs_two_pieces_and_merges_near_identical_colours() -> None:
    result = outfit_colours(
        [
            ("a", [swatch(RED, 70, "sindoor"), swatch(TEAL, 30, "teal")]),
            ("b", [swatch(ALMOST_RED, 60, "red"), swatch(IVORY, 40, "ivory")]),
        ]
    )
    assert [(c.name, c.item_ids) for c in result.shared] == [("sindoor", ("a", "b"))]


def test_a_colour_repeated_within_one_piece_is_not_shared() -> None:
    result = outfit_colours([("a", [swatch(RED, 50), swatch(ALMOST_RED, 50)]), ("b", None)])
    assert result.shared == []
    assert len(result.dominant) == 1


def test_complementary_needs_opposite_hues_on_different_pieces() -> None:
    together = outfit_colours([("a", [swatch(RED, 50, "red"), swatch(TEAL, 50, "teal")])])
    assert together.complementary == []  # both on one piece

    apart = outfit_colours([("a", [swatch(RED, 100, "red")]), ("b", [swatch(TEAL, 100, "teal")])])
    assert [{a.name, b.name} for a, b in apart.complementary] == [{"red", "teal"}]


def test_greys_are_never_complementary() -> None:
    result = outfit_colours([("a", [swatch(GREY, 100)]), ("b", [swatch(RED, 100)])])
    assert result.complementary == []


def test_contrast_is_a_large_lightness_gap_on_different_pieces() -> None:
    far = outfit_colours(
        [("a", [swatch(IVORY, 100, "ivory")]), ("b", [swatch(CHARCOAL, 100, "ink")])]
    )
    assert [{a.name, b.name} for a, b in far.contrasting] == [{"ivory", "ink"}]

    near = outfit_colours([("a", [swatch(GREY, 100)]), ("b", [swatch(PALE_GREY, 100)])])
    assert near.contrasting == []


def test_tiny_swatches_are_ignored() -> None:
    result = outfit_colours([("a", [swatch(RED, 96, "red"), swatch(TEAL, 4, "speck")])])
    assert [c.name for c in result.dominant] == ["red"]


def test_the_result_does_not_depend_on_piece_order_for_shares() -> None:
    a = ("a", [swatch(RED, 100, "red")])
    b = ("b", [swatch(IVORY, 100, "ivory")])
    assert [c.share for c in outfit_colours([a, b]).dominant] == [
        c.share for c in outfit_colours([b, a]).dominant
    ]
