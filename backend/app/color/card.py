"""Render a palette as a shareable PNG card (1200 x 675, editorial style)."""

import io
from collections.abc import Sequence
from typing import Any

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1200, 675
PAPER = (247, 243, 236)
INK = (34, 32, 28)
MUTED = (107, 101, 92)
MARGIN = 56
BAND_HEIGHT = 300


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    return ImageFont.load_default(size=size)  # Pillow's bundled font: no system dependency


def render_palette_card(colors: Sequence[dict[str, Any]], title: str = "Thread palette") -> bytes:
    """`colors` are stored palette entries: {"hex", "name", "percentage", ...}."""
    if not colors:
        raise ValueError("A palette card needs at least one colour.")
    card = Image.new("RGB", (WIDTH, HEIGHT), PAPER)
    draw = ImageDraw.Draw(card)

    # Proportional band: each colour's width matches its share of the image.
    x = MARGIN
    band_width = WIDTH - 2 * MARGIN
    for index, color in enumerate(colors):
        right = (
            WIDTH - MARGIN
            if index == len(colors) - 1
            else x + round(band_width * float(color["percentage"]) / 100)
        )
        draw.rectangle((x, MARGIN, max(x, right - 1), MARGIN + BAND_HEIGHT), fill=color["hex"])
        x = right

    # Chips: swatch + name + hex + share.
    columns = min(len(colors), 6)
    column_width = band_width // columns
    top = MARGIN + BAND_HEIGHT + 40
    for index, color in enumerate(colors[:columns]):
        left = MARGIN + index * column_width
        draw.rectangle((left, top, left + 44, top + 44), fill=color["hex"], outline=(226, 218, 205))
        draw.text((left, top + 60), str(color["name"])[:22], fill=INK, font=_font(22))
        draw.text((left, top + 92), str(color["hex"]).upper(), fill=MUTED, font=_font(20))
        draw.text(
            (left, top + 120), f"{float(color['percentage']):.1f}%", fill=MUTED, font=_font(20)
        )

    draw.text((MARGIN, HEIGHT - MARGIN - 6), title, fill=INK, font=_font(24))
    note = "Approximate colours · lighting and camera settings affect results"
    note_width = draw.textlength(note, font=_font(16))
    draw.text((WIDTH - MARGIN - note_width, HEIGHT - MARGIN), note, fill=MUTED, font=_font(16))

    buffer = io.BytesIO()
    card.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()
