"""Palette extraction on synthetic images with known colours and areas."""

import numpy as np
import pytest
from PIL import Image

from app.color.lab import delta_e_2000, srgb_to_lab, to_hex
from app.color.palette import (
    PaletteError,
    estimate_background_mask,
    extract_palette,
)
from tests.images import blocks

HALDI = (227, 160, 24)
INDIGO = (38, 59, 94)
SINDOOR = (209, 41, 28)
WHITE = (255, 255, 255)


def by_hex(palette):  # noqa: ANN001, ANN201
    return {c.hex: c for c in palette.colors}


def assert_valid(palette) -> None:  # noqa: ANN001
    shares = [c.percentage for c in palette.colors]
    assert sum(shares) == pytest.approx(100.0, abs=1e-9)
    assert all(round(s, 1) == s and s > 0 for s in shares)
    assert shares == sorted(shares, reverse=True)
    for color in palette.colors:
        # Displayed values are consistent: hex == rgb, and lab describes that rgb.
        assert color.hex == to_hex(color.rgb)
        assert delta_e_2000(srgb_to_lab(color.rgb), color.lab) < 0.05
        assert color.name and color.family


def test_two_known_colours_and_their_areas() -> None:
    image = blocks((1000, 1000), HALDI, [((0, 0, 1000, 300), INDIGO)])

    palette = extract_palette(image)

    assert_valid(palette)
    colors = by_hex(palette)
    assert set(colors) == {"#e3a018", "#263b5e"}
    assert colors["#e3a018"].percentage == pytest.approx(70, abs=1)
    assert colors["#263b5e"].percentage == pytest.approx(30, abs=1)
    assert colors["#e3a018"].name == "haldi yellow"
    assert colors["#263b5e"].name == "neel indigo"
    assert palette.source == "original"


def test_three_colours_in_known_proportions() -> None:
    image = blocks((600, 400), WHITE, [((0, 0, 300, 400), SINDOOR), ((300, 0, 450, 400), INDIGO)])

    palette = extract_palette(image, detect_background=False)

    shares = {c.hex: c.percentage for c in palette.colors}
    assert shares == pytest.approx({"#d1291c": 50, "#263b5e": 25, "#ffffff": 25}, abs=1)


def test_single_colour_image() -> None:
    palette = extract_palette(blocks((300, 200), SINDOOR))

    assert [(c.hex, c.percentage, c.name) for c in palette.colors] == [
        ("#d1291c", 100.0, "sindoor red")
    ]


def test_near_monochrome_shades_merge_into_one_colour() -> None:
    # Tiny random variation around one colour (sensor noise), not separate colours.
    rng = np.random.default_rng(1)
    noise = rng.integers(-2, 3, size=(200, 200, 3))
    pixels = np.clip(np.array(HALDI) + noise, 0, 255).astype(np.uint8)

    palette = extract_palette(Image.fromarray(pixels, "RGB"))

    assert len(palette.colors) == 1
    assert palette.colors[0].percentage == 100.0
    assert delta_e_2000(srgb_to_lab(palette.colors[0].rgb), srgb_to_lab(HALDI)) < 1.5


def test_transparent_pixels_are_ignored() -> None:
    image = blocks((400, 400), (0, 0, 0, 0), [((0, 0, 200, 400), (*SINDOOR, 255))], mode="RGBA")

    palette = extract_palette(image)

    assert [(c.hex, c.percentage) for c in palette.colors] == [("#d1291c", 100.0)]


def test_fully_transparent_image_is_an_error_not_a_made_up_palette() -> None:
    with pytest.raises(PaletteError):
        extract_palette(blocks((100, 100), (10, 20, 30, 0), mode="RGBA"))


@pytest.mark.parametrize("size", [(1, 1), (2, 3), (7, 5)])
def test_tiny_images(size: tuple[int, int]) -> None:
    palette = extract_palette(blocks(size, INDIGO))
    assert [c.hex for c in palette.colors] == ["#263b5e"]


@pytest.mark.parametrize("mode", ["L", "LA", "P", "CMYK", "I;16"])
def test_unusual_image_modes(mode: str) -> None:
    source = blocks((120, 80), HALDI, [((0, 0, 60, 80), INDIGO)])
    # An adaptive palette maps the two colours exactly; the default web palette would dither
    # them into many real colours, which extraction would (correctly) report.
    image = (
        source.convert("P", palette=Image.Palette.ADAPTIVE, colors=8)
        if mode == "P"
        else source.convert(mode)
    )
    palette = extract_palette(image, detect_background=False)
    assert_valid(palette)
    assert 1 <= len(palette.colors) <= 2


def test_busy_photo_respects_the_colour_count_and_is_deterministic() -> None:
    rng = np.random.default_rng(7)
    pixels = rng.integers(0, 256, size=(300, 300, 3), dtype=np.uint8)
    image = Image.fromarray(pixels, "RGB")

    first = extract_palette(image, n_colors=4)
    second = extract_palette(image, n_colors=4)

    assert_valid(first)
    assert 1 <= len(first.colors) <= 4
    assert first == second


@pytest.mark.parametrize("n_colors", [0, 13])
def test_colour_count_bounds(n_colors: int) -> None:
    with pytest.raises(ValueError, match="between 1 and 12"):
        extract_palette(blocks((50, 50), WHITE), n_colors=n_colors)


def test_tiny_slivers_are_dropped_and_shares_renormalised() -> None:
    # A 0.25% speck is below the 1% threshold and must not appear as a palette colour.
    image = blocks((400, 400), INDIGO, [((0, 0, 20, 20), SINDOOR)])

    palette = extract_palette(image, detect_background=False)

    assert [(c.hex, c.percentage) for c in palette.colors] == [("#263b5e", 100.0)]


# --- background mask -------------------------------------------------------------------


def product_photo() -> Image.Image:
    """A red garment on a plain white studio backdrop."""
    return blocks((800, 1000), WHITE, [((250, 200, 550, 800), SINDOOR)])


def test_plain_backdrop_is_excluded() -> None:
    palette = extract_palette(product_photo())

    assert palette.source == "masked"
    assert [(c.hex, c.percentage) for c in palette.colors] == [("#d1291c", 100.0)]


def test_background_detection_can_be_switched_off_for_fabric() -> None:
    palette = extract_palette(product_photo(), detect_background=False)

    assert palette.source == "original"
    assert {c.hex for c in palette.colors} == {"#d1291c", "#ffffff"}


def test_busy_border_means_no_mask() -> None:
    rng = np.random.default_rng(3)
    pixels = rng.integers(0, 256, size=(200, 200, 4), dtype=np.uint8)
    pixels[..., 3] = 255
    assert estimate_background_mask(pixels) is None


def test_mask_rejected_when_foreground_is_implausibly_small() -> None:
    speck = np.asarray(blocks((200, 200), WHITE, [((100, 100, 103, 103), SINDOOR)]).convert("RGBA"))
    assert estimate_background_mask(speck) is None
