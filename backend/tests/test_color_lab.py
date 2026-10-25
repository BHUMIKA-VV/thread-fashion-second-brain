import numpy as np
import pytest

from app.color.lab import (
    delta_e_2000,
    from_hex,
    lab_to_lch,
    lab_to_srgb,
    srgb_to_lab,
    to_hex,
)


@pytest.mark.parametrize(
    ("rgb", "expected"),
    [
        ((255, 255, 255), (100.0, 0.0, 0.0)),
        ((0, 0, 0), (0.0, 0.0, 0.0)),
        ((255, 0, 0), (53.24, 80.09, 67.20)),
        ((0, 255, 0), (87.73, -86.18, 83.18)),
        ((0, 0, 255), (32.30, 79.19, -107.86)),
        ((128, 128, 128), (53.59, 0.0, 0.0)),
    ],
)
def test_srgb_to_lab_reference_values(
    rgb: tuple[int, int, int], expected: tuple[float, ...]
) -> None:
    assert srgb_to_lab(rgb) == pytest.approx(expected, abs=0.02)


def test_round_trip_is_exact_for_every_channel_value() -> None:
    values = np.arange(256)
    rgb = np.stack([values, values[::-1], (values * 7) % 256], axis=-1)
    assert np.array_equal(lab_to_srgb(srgb_to_lab(rgb)), rgb)


def test_out_of_gamut_lab_is_clipped_not_wrapped() -> None:
    # A far-out-of-gamut magenta: channels saturate at 0/255 instead of overflowing.
    rgb = lab_to_srgb([50, 200, -200])
    assert rgb.dtype == np.uint8
    assert (rgb[1], rgb[2]) == (0, 255)
    assert 100 < rgb[0] < 255


# Selected pairs from Sharma, Wu & Dalal (2005), "The CIEDE2000 Color-Difference Formula:
# Implementation Notes, Supplementary Test Data, and Mathematical Observations", Table 1.
SHARMA_PAIRS = [
    ((50.0000, 2.6772, -79.7751), (50.0000, 0.0000, -82.7485), 2.0425),
    ((50.0000, 3.1571, -77.2803), (50.0000, 0.0000, -82.7485), 2.8615),
    ((50.0000, 0.0000, 0.0000), (50.0000, -1.0000, 2.0000), 2.3669),
    ((50.0000, 2.4900, -0.0010), (50.0000, -2.4900, 0.0009), 7.1792),
    ((50.0000, 2.5000, 0.0000), (73.0000, 25.0000, -18.0000), 27.1492),
    ((50.0000, 2.5000, 0.0000), (50.0000, 3.2592, 0.3350), 1.0000),
    ((60.2574, -34.0099, 36.2677), (60.4626, -34.1751, 39.4387), 1.2644),
    ((22.7233, 20.0904, -46.6940), (23.0331, 14.9730, -42.5619), 2.0373),
    ((90.8027, -2.0831, 1.4410), (91.1528, -1.6435, 0.0447), 1.4441),
    ((2.0776, 0.0795, -1.1350), (0.9033, -0.0636, -0.5514), 0.9082),
]


@pytest.mark.parametrize(("lab1", "lab2", "expected"), SHARMA_PAIRS)
def test_ciede2000_matches_published_test_data(lab1, lab2, expected) -> None:  # noqa: ANN001
    assert delta_e_2000(lab1, lab2) == pytest.approx(expected, abs=1e-4)
    assert delta_e_2000(lab2, lab1) == pytest.approx(expected, abs=1e-4)  # symmetric


def test_ciede2000_broadcasts() -> None:
    labs = np.array([pair[0] for pair in SHARMA_PAIRS])
    others = np.array([pair[1] for pair in SHARMA_PAIRS])
    expected = [pair[2] for pair in SHARMA_PAIRS]
    assert delta_e_2000(labs, others) == pytest.approx(expected, abs=1e-4)
    assert delta_e_2000(labs[0], labs[0]) == 0


def test_lch_and_hex_helpers() -> None:
    lightness, chroma, hue = lab_to_lch([50, 0, 10])
    assert (lightness, chroma, hue) == pytest.approx((50, 10, 90))
    assert to_hex((227, 160, 24)) == "#e3a018"
    assert from_hex("#E3A018") == (227, 160, 24)
