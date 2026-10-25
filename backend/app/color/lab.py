"""sRGB <-> CIELAB conversion and the CIEDE2000 colour difference, vectorised with NumPy.

Why LAB: Euclidean distance in RGB does not match how different two colours *look*.
CIELAB is designed so equal distances are roughly equally noticeable, which makes K-means
clusters and nearest-name lookups perceptually meaningful. CIEDE2000 refines that further.

All functions take arrays shaped (..., 3). sRGB values are 0-255; LAB uses the D65 white point.
"""

import numpy as np
from numpy.typing import ArrayLike, NDArray

# sRGB (D65) <-> CIE XYZ matrices (IEC 61966-2-1).
_RGB_TO_XYZ = np.array(
    [
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ]
)
_XYZ_TO_RGB = np.linalg.inv(_RGB_TO_XYZ)
_WHITE_D65 = np.array([0.95047, 1.0, 1.08883])
_EPSILON = 216 / 24389
_KAPPA = 24389 / 27

Float = NDArray[np.float64]


def srgb_to_lab(rgb: ArrayLike) -> Float:
    c = np.asarray(rgb, dtype=np.float64) / 255.0
    linear = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    xyz = linear @ _RGB_TO_XYZ.T / _WHITE_D65
    f = np.where(xyz > _EPSILON, np.cbrt(xyz), (_KAPPA * xyz + 16) / 116)
    lightness = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([lightness, a, b], axis=-1)


def lab_to_srgb(lab: ArrayLike) -> NDArray[np.uint8]:
    """LAB -> sRGB 0-255, clipped to the displayable gamut and rounded."""
    lab = np.asarray(lab, dtype=np.float64)
    fy = (lab[..., 0] + 16) / 116
    fx = fy + lab[..., 1] / 500
    fz = fy - lab[..., 2] / 200
    f = np.stack([fx, fy, fz], axis=-1)
    xyz = np.where(f**3 > _EPSILON, f**3, (116 * f - 16) / _KAPPA) * _WHITE_D65
    linear = np.clip(xyz @ _XYZ_TO_RGB.T, 0.0, 1.0)
    c = np.where(linear <= 0.0031308, 12.92 * linear, 1.055 * linear ** (1 / 2.4) - 0.055)
    return np.rint(np.clip(c, 0.0, 1.0) * 255).astype(np.uint8)


def lab_to_lch(lab: ArrayLike) -> Float:
    """LAB -> (L, chroma, hue in degrees 0-360)."""
    lab = np.asarray(lab, dtype=np.float64)
    chroma = np.hypot(lab[..., 1], lab[..., 2])
    hue = np.degrees(np.arctan2(lab[..., 2], lab[..., 1])) % 360
    return np.stack([lab[..., 0], chroma, hue], axis=-1)


def delta_e_2000(lab1: ArrayLike, lab2: ArrayLike) -> Float:
    """CIEDE2000 difference (Sharma, Wu & Dalal 2005). Broadcasts like NumPy."""
    lab1 = np.asarray(lab1, dtype=np.float64)
    lab2 = np.asarray(lab2, dtype=np.float64)
    l1, a1, b1 = lab1[..., 0], lab1[..., 1], lab1[..., 2]
    l2, a2, b2 = lab2[..., 0], lab2[..., 1], lab2[..., 2]

    c_bar = (np.hypot(a1, b1) + np.hypot(a2, b2)) / 2
    g = 0.5 * (1 - np.sqrt(c_bar**7 / (c_bar**7 + 25.0**7)))
    a1p, a2p = (1 + g) * a1, (1 + g) * a2
    c1p, c2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p = np.degrees(np.arctan2(b1, a1p)) % 360
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360

    dl = l2 - l1
    dc = c2p - c1p
    dh_raw = h2p - h1p
    dh = np.where(dh_raw > 180, dh_raw - 360, np.where(dh_raw < -180, dh_raw + 360, dh_raw))
    dh = np.where(c1p * c2p == 0, 0.0, dh)
    dh_big = 2 * np.sqrt(c1p * c2p) * np.sin(np.radians(dh) / 2)

    l_bar = (l1 + l2) / 2
    c_bar_p = (c1p + c2p) / 2
    h_sum = h1p + h2p
    h_bar = np.where(
        c1p * c2p == 0,
        h_sum,
        np.where(
            np.abs(h1p - h2p) <= 180,
            h_sum / 2,
            np.where(h_sum < 360, (h_sum + 360) / 2, (h_sum - 360) / 2),
        ),
    )
    t = (
        1
        - 0.17 * np.cos(np.radians(h_bar - 30))
        + 0.24 * np.cos(np.radians(2 * h_bar))
        + 0.32 * np.cos(np.radians(3 * h_bar + 6))
        - 0.20 * np.cos(np.radians(4 * h_bar - 63))
    )
    d_theta = 30 * np.exp(-(((h_bar - 275) / 25) ** 2))
    r_c = 2 * np.sqrt(c_bar_p**7 / (c_bar_p**7 + 25.0**7))
    s_l = 1 + 0.015 * (l_bar - 50) ** 2 / np.sqrt(20 + (l_bar - 50) ** 2)
    s_c = 1 + 0.045 * c_bar_p
    s_h = 1 + 0.015 * c_bar_p * t
    r_t = -np.sin(np.radians(2 * d_theta)) * r_c

    return np.sqrt(
        (dl / s_l) ** 2 + (dc / s_c) ** 2 + (dh_big / s_h) ** 2 + r_t * (dc / s_c) * (dh_big / s_h)
    )


def to_hex(rgb: ArrayLike) -> str:
    r, g, b = (int(v) for v in np.asarray(rgb).reshape(3))
    return f"#{r:02x}{g:02x}{b:02x}"


def from_hex(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)
