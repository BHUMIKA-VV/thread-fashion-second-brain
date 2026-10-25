import io

import pytest
from PIL import Image

from app.color.card import HEIGHT, MARGIN, WIDTH, render_palette_card
from app.color.harmony import detect_harmony
from app.color.lab import srgb_to_lab
from app.models.enums import Harmony


def swatches(*pairs: tuple[tuple[int, int, int], float]):  # noqa: ANN201
    return [(tuple(srgb_to_lab(rgb)), share) for rgb, share in pairs]


@pytest.mark.parametrize(
    ("palette", "expected"),
    [
        (
            swatches(((255, 255, 255), 60), ((128, 128, 128), 30), ((20, 20, 20), 10)),
            Harmony.NEUTRAL,
        ),
        (
            swatches(((30, 60, 160), 50), ((90, 120, 200), 30), ((255, 255, 255), 20)),
            Harmony.MONOCHROMATIC,
        ),
        (swatches(((209, 41, 28), 50), ((227, 160, 24), 50)), Harmony.ANALOGOUS),
        # Opposite in perceptual LCh: orange 64° vs cerulean 249°. (A saturated blue at ~296°
        # is "opposite" orange only on the painter's RYB wheel, so it counts as mixed here.)
        (swatches(((255, 140, 0), 50), ((0, 140, 190), 50)), Harmony.COMPLEMENTARY),
        (swatches(((255, 140, 0), 50), ((0, 70, 200), 50)), Harmony.MIXED),
        (swatches(((220, 30, 30), 34), ((30, 160, 40), 33), ((40, 60, 200), 33)), Harmony.MIXED),
    ],
)
def test_harmony_labels(palette, expected: Harmony) -> None:  # noqa: ANN001
    assert detect_harmony(palette) == expected


def test_small_or_greyish_swatches_do_not_count_as_hues() -> None:
    # A 3% blue accent is ignored, so this stays monochromatic.
    palette = swatches(((209, 41, 28), 70), ((180, 30, 40), 27), ((0, 0, 255), 3))
    assert detect_harmony(palette) == Harmony.MONOCHROMATIC


def test_palette_card_png() -> None:
    colors = [
        {"hex": "#e3a018", "name": "haldi yellow", "percentage": 70.0},
        {"hex": "#263b5e", "name": "neel indigo", "percentage": 30.0},
    ]

    data = render_palette_card(colors)
    card = Image.open(io.BytesIO(data))

    assert card.format == "PNG" and card.size == (WIDTH, HEIGHT)
    assert card.getpixel((MARGIN + 5, MARGIN + 5)) == (227, 160, 24)
    assert card.getpixel((WIDTH - MARGIN - 5, MARGIN + 5)) == (38, 59, 94)


def test_palette_card_needs_colours() -> None:
    with pytest.raises(ValueError):
        render_palette_card([])
