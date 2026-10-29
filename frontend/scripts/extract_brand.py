"""Extract Thread's official logo and app icon from the brand reference image (run once).

The source is scripts/brand-source/thread-reference.webp (the supplied brand board). This
crops the THREAD wordmark and the small-scale app icon out of it, removes the paper
background, recolours to the exact brand palette and writes:

  public/brand/thread-wordmark[-light|-mono|-mono-light].png   (transparent, 3x upscaled)
  public/brand/thread-app-icon.png                             (512 px, rounded tile)
  src/app/icon.png, src/app/apple-icon.png, src/app/favicon.ico

    ../backend/.venv/Scripts/python scripts/extract_brand.py

Limits: the board is 1408x768, so the wordmark crop is ~460x160 px and the icon ~68 px. They
are upscaled for smoother edges but carry no more detail than the source; the wordmark is
sharp up to roughly 160 px tall on screen, the icon at favicon and home-screen sizes is soft.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts" / "brand-source" / "thread-reference.webp"
WORDMARK_BOX = (268, 280, 730, 441)  # left, top, right, bottom in the source board
ICON_BOX = (801, 356, 866, 420)  # 1-2 px inside the tile, so no paper rim
UPSCALE = 3

INK, INDIGO = (0x20, 0x23, 0x21), (0x24, 0x46, 0x6B)
IVORY, SAND = (0xF6, 0xF1, 0xE8), (0xD9, 0xC8, 0xB1)
TONES = {
    "thread-wordmark": (INK, INDIGO),
    "thread-wordmark-light": (IVORY, SAND),
    "thread-wordmark-mono": (INK, INK),
    "thread-wordmark-mono-light": (IVORY, IVORY),
}


def wordmark_layers(board: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    """Alpha masks (0..1) for the letters and for the thread."""
    crop = board.crop(WORDMARK_BOX)
    crop = crop.resize((crop.width * UPSCALE, crop.height * UPSCALE), Image.Resampling.LANCZOS)
    px = np.asarray(crop, dtype=np.float32)
    border = np.concatenate([px[:4].reshape(-1, 3), px[-4:].reshape(-1, 3), px[:, :4].reshape(-1, 3), px[:, -4:].reshape(-1, 3)])
    paper = np.median(border, axis=0)
    lum = px @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    paper_lum = float(paper @ np.array([0.299, 0.587, 0.114]))
    darkness = np.clip(paper_lum - lum, 0, None)
    # The thread is indigo: noticeably bluer than red relative to how dark it is.
    blueness = (px[..., 2] - px[..., 0]) - (paper[2] - paper[0])
    is_thread = blueness > np.maximum(10, 0.18 * darkness)
    ink_full = paper_lum - np.percentile(lum[~is_thread & (darkness > 40)], 5)
    thread_full = paper_lum - np.percentile(lum[is_thread & (darkness > 20)], 10)
    letters = np.where(is_thread, 0, darkness / ink_full)
    thread = np.where(is_thread, darkness / thread_full, 0)
    # Paper texture and compression noise must not leave a faint haze.
    letters = np.clip((np.clip(letters, 0, 1) - 0.08) / 0.92, 0, 1)
    thread = np.clip((np.clip(thread, 0, 1) - 0.08) / 0.92, 0, 1)
    return letters, thread


def compose(letters: np.ndarray, thread: np.ndarray, ink: tuple, line: tuple) -> Image.Image:
    alpha = np.clip(letters + thread, 0, 1)
    weight = np.divide(thread, alpha, out=np.zeros_like(alpha), where=alpha > 0)
    rgb = (1 - weight)[..., None] * np.array(ink) + weight[..., None] * np.array(line)
    rgba = np.dstack([rgb, alpha * 255]).round().astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def app_icon(board: Image.Image, size: int) -> Image.Image:
    """The icon tile, upscaled, with clean transparent rounded corners."""
    tile = board.crop(ICON_BOX).resize((size, size), Image.Resampling.LANCZOS).convert("RGBA")
    big = size * 4
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, big - 1, big - 1), radius=round(big * 0.2), fill=255)
    tile.putalpha(mask.resize((size, size), Image.Resampling.LANCZOS))
    return tile


def main() -> None:
    board = Image.open(SOURCE).convert("RGB")
    brand = ROOT / "public" / "brand"
    brand.mkdir(parents=True, exist_ok=True)
    letters, thread = wordmark_layers(board)
    for name, (ink, line) in TONES.items():
        compose(letters, thread, ink, line).save(brand / f"{name}.png", optimize=True)
    app_icon(board, 512).save(brand / "thread-app-icon.png", optimize=True)
    app = ROOT / "src" / "app"
    app_icon(board, 192).save(app / "icon.png", optimize=True)
    app_icon(board, 180).convert("RGB").save(app / "apple-icon.png", optimize=True)
    app_icon(board, 48).save(app / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)], bitmap_format="bmp")  # classic entries decode everywhere
    w, h = letters.shape[1], letters.shape[0]
    print(f"wordmark {w}x{h} px (aspect {w / h:.4f}); icon 512/192/180 px; favicon 16/32/48")


if __name__ == "__main__":
    main()
