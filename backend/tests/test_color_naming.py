import json

import pytest

from app.color.lab import srgb_to_lab
from app.color.naming import DATA_DIR, FAMILIES, family_for_lab, name_for_rgb, reference_names


def test_reference_lists_are_loaded() -> None:
    refs = reference_names()
    xkcd = json.loads((DATA_DIR / "xkcd_colors.json").read_text(encoding="utf-8"))
    assert xkcd["license"].startswith("CC0")
    assert refs.sources.count("xkcd") == len(xkcd["colors"]) == 949
    assert refs.sources.count("indian") >= 20
    assert refs.lab.shape == (len(refs.names), 3)


@pytest.mark.parametrize(
    ("rgb", "name"),
    [
        ((227, 160, 24), "haldi yellow"),
        ((209, 41, 28), "sindoor red"),
        ((107, 124, 42), "mehendi green"),
        ((231, 84, 128), "gulabi pink"),
        ((38, 59, 94), "neel indigo"),
        ((56, 2, 130), "indigo"),  # the xkcd name
        ((21, 176, 26), "green"),
    ],
)
def test_exact_reference_colours_get_their_own_name(rgb: tuple[int, int, int], name: str) -> None:
    assert name_for_rgb(rgb) == name


def test_nearby_colour_takes_the_nearest_name() -> None:
    assert name_for_rgb((225, 162, 30)) == "haldi yellow"  # a few units off


def test_naming_is_deterministic() -> None:
    assert {name_for_rgb((90, 120, 160)) for _ in range(5)} == {name_for_rgb((90, 120, 160))}


@pytest.mark.parametrize(
    ("rgb", "family"),
    [
        ((255, 0, 0), "red"),
        ((255, 140, 0), "orange"),
        ((255, 255, 0), "yellow"),
        ((0, 128, 0), "green"),
        ((0, 128, 128), "teal"),
        ((0, 0, 128), "blue"),
        ((21, 96, 189), "blue"),
        ((128, 0, 128), "purple"),
        ((255, 105, 180), "pink"),
        ((139, 69, 19), "brown"),
        ((210, 180, 140), "beige"),
        ((255, 255, 255), "white"),
        ((128, 128, 128), "grey"),
        ((15, 15, 15), "black"),
    ],
)
def test_families(rgb: tuple[int, int, int], family: str) -> None:
    assert family in FAMILIES
    assert family_for_lab(srgb_to_lab(rgb)) == family
