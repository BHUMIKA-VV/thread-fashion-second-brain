"""Build the public demo's static dataset from a curated set of images.

  python -m scripts.build_demo --manifest <folder>/demo.json [--out ../frontend/public/demo]
  python -m scripts.build_demo --manifest <folder>/demo.json --no-model

The demo at /demo is read-only and static: visitors load a JSON file and images, and nothing
reaches the API, the database or the image model. This script is where the work happens,
once, offline: every palette, tag, similarity and outfit colour in the output is computed here
by the same code the app uses (app/color, app/ml), so the demo shows what Thread actually
produces, never hand-written results.

The manifest lists the pieces, collections and outfits:

  {
    "pieces": [{"id": "indigo-kurta", "file": "kurta.jpg", "type": "garment",
                "title": "Indigo kurta", "note": "optional", "credit": "Photo: …",
                "licence": "Own photograph", "tags": [{"category": "weave", "tag": "twill"}]}],
    "collections": [{"id": "everyday", "title": "Everyday wardrobe",
                     "description": "…", "pieces": ["indigo-kurta"]}],
    "outfits": [{"id": "monsoon", "title": "Monsoon office", "note": "…",
                 "pieces": ["indigo-kurta"]}],
    "boards": [{"id": "indigo-study", "title": "Indigo study", "description": "…",
                "blocks": [{"kind": "heading", "body": "Blues"},
                           {"kind": "piece", "piece": "indigo-kurta", "body": "optional caption"},
                           {"kind": "colour", "hex": "#263b5e", "body": "optional caption"},
                           {"kind": "note", "body": "…"}]}]
  }

Every piece needs a credit and a licence: the demo is public, so only images you have the
right to publish belong here. Tags given in the manifest are recorded by a person and replace
the model's suggestions in that category, as a correction does in the app. An optional
"crop": [left, top, right, bottom] (fractions of the image) trims a studio backdrop before
anything is measured; the published image is the cropped one, so visitors see exactly what
was measured.

A board's colour story (measured colours, each chosen colour's nearest measured one, harmony)
is calculated here by the app's own board code, as the app does for a saved board.

Output: demo.json, images/<id>.webp (long side 1600) and thumbs/<id>.webp (long side 640).
It also writes the playground's index (app/playground/demo_index.json, or --index): each
piece's palette and image vector, so the public playground can compare a visitor's photo
with the demo without a database. The vectors are tied to the model that made them.
Images are re-encoded, which drops EXIF and other metadata (camera, location). Rerunning
with the same inputs gives the same files. Without the image model (--no-model, or no
weights), tags and look-alike similarity are left out and the output says so.
"""

import argparse
import io
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageOps

from app.color.board import colour_story
from app.color.compare import dominant_family, palette_distance
from app.color.outfit import OutfitColour, outfit_colours
from app.color.palette import extract_palette
from app.core.config import get_settings
from app.ml import registry, vocabulary
from app.ml.embedder import Embedder
from app.ml.tagging import Tagger
from app.models.enums import ItemType

FORMAT_VERSION = 1
INDEX_VERSION = 1
DEFAULT_INDEX = Path(__file__).resolve().parents[1] / "app" / "playground" / "demo_index.json"
IMAGE_SIDE = 1600
THUMB_SIDE = 640
SIMILAR = 6
ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
REQUIRED = ("id", "file", "type", "title", "credit", "licence")
HEX = re.compile(r"^#[0-9a-f]{6}$")
BLOCK_KINDS = ("piece", "colour", "heading", "note")
MAX_BLOCKS = 120  # as in the app
TEXT_LIMITS = {"heading": 200, "note": 2000, "piece": 2000, "colour": 2000}


class ManifestError(ValueError):
    """The manifest is incomplete or inconsistent."""


@dataclass(frozen=True)
class Model:
    embedder: Embedder
    tagger: Tagger


def _require_text(entry: dict[str, Any], key: str, where: str) -> str:
    value = entry.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ManifestError(f"{where}: '{key}' is required")
    return value.strip()


def _check_id(value: str, where: str, seen: set[str]) -> None:
    if not ID.match(value):
        raise ManifestError(f"{where}: id '{value}' must be lowercase letters, digits and dashes")
    if value in seen:
        raise ManifestError(f"{where}: id '{value}' is used twice")
    seen.add(value)


def _recorded_tags(entry: dict[str, Any], where: str) -> list[dict[str, str]]:
    tags = []
    for tag in entry.get("tags", []):
        category, value = tag.get("category"), tag.get("tag")
        if category not in vocabulary.BY_NAME:
            raise ManifestError(f"{where}: unknown tag category '{category}'")
        if value not in vocabulary.vocabulary_tags(category):
            raise ManifestError(f"{where}: '{value}' is not a {category} tag in the vocabulary")
        tags.append({"category": category, "tag": value})
    return tags


def _crop(entry: dict[str, Any], where: str) -> tuple[float, float, float, float] | None:
    crop = entry.get("crop")
    if crop is None:
        return None
    if not (
        isinstance(crop, list) and len(crop) == 4 and all(isinstance(v, int | float) for v in crop)
    ):
        raise ManifestError(f"{where}: crop must be [left, top, right, bottom]")
    left, top, right, bottom = (float(v) for v in crop)
    if not (0 <= left < right <= 1 and 0 <= top < bottom <= 1):
        raise ManifestError(
            f"{where}: crop fractions must be between 0 and 1, left < right, top < bottom"
        )
    return left, top, right, bottom


def load_manifest(path: Path) -> dict[str, Any]:
    """Read and check the manifest; image paths are resolved next to it."""
    manifest = json.loads(path.read_text(encoding="utf-8"))
    pieces = manifest.get("pieces")
    if not isinstance(pieces, list) or not pieces:
        raise ManifestError("the manifest needs at least one piece")
    seen: set[str] = set()
    for i, piece in enumerate(pieces):
        where = f"piece {i + 1}"
        for key in REQUIRED:
            piece[key] = _require_text(piece, key, where)
        _check_id(piece["id"], where, seen)
        if piece["type"] not in {t.value for t in ItemType}:
            raise ManifestError(f"{where}: unknown type '{piece['type']}'")
        piece["path"] = (path.parent / piece["file"]).resolve()
        if not piece["path"].is_file():
            raise ManifestError(f"{where}: image '{piece['file']}' not found")
        piece["tags"] = _recorded_tags(piece, where)
        piece["crop"] = _crop(piece, where)

    piece_ids = {p["id"] for p in pieces}
    for group in ("collections", "outfits"):
        manifest[group] = manifest.get(group, [])
        group_seen: set[str] = set()
        for i, entry in enumerate(manifest[group]):
            where = f"{group[:-1]} {i + 1}"
            entry["title"] = _require_text(entry, "title", where)
            _check_id(_require_text(entry, "id", where), where, group_seen)
            members = entry.get("pieces", [])
            if not members:
                raise ManifestError(f"{where}: needs at least one piece")
            missing = [m for m in members if m not in piece_ids]
            if missing:
                raise ManifestError(f"{where}: unknown pieces {', '.join(missing)}")
    manifest["boards"] = manifest.get("boards", [])
    board_seen: set[str] = set()
    for i, board in enumerate(manifest["boards"]):
        where = f"board {i + 1}"
        board["title"] = _require_text(board, "title", where)
        _check_id(_require_text(board, "id", where), where, board_seen)
        blocks = board.get("blocks", [])
        if not blocks or len(blocks) > MAX_BLOCKS:
            raise ManifestError(f"{where}: needs between 1 and {MAX_BLOCKS} blocks")
        for j, block in enumerate(blocks):
            _check_block(block, piece_ids, f"{where}, block {j + 1}")
    return manifest


def _check_block(block: dict[str, Any], piece_ids: set[str], where: str) -> None:
    """The same rules as the app's boards: a piece names a piece, a colour has a hex, a heading
    or a note has text."""
    kind = block.get("kind")
    if kind not in BLOCK_KINDS:
        raise ManifestError(f"{where}: kind must be one of {', '.join(BLOCK_KINDS)}")
    body = block.get("body")
    if body is not None and (not isinstance(body, str) or not body.strip()):
        raise ManifestError(f"{where}: 'body' must be text")
    if kind in ("heading", "note") and body is None:
        raise ManifestError(f"{where}: a {kind} needs a 'body'")
    if body is not None and len(body.strip()) > TEXT_LIMITS[kind]:
        raise ManifestError(f"{where}: 'body' is longer than {TEXT_LIMITS[kind]} characters")
    if kind == "piece" and block.get("piece") not in piece_ids:
        raise ManifestError(f"{where}: unknown piece {block.get('piece')}")
    if kind == "colour":
        hex_value = block.get("hex")
        if not isinstance(hex_value, str) or not HEX.match(hex_value.lower()):
            raise ManifestError(f"{where}: 'hex' must look like #263b5e")
        block["hex"] = hex_value.lower()
    if kind != "piece" and "piece" in block:
        raise ManifestError(f"{where}: only a piece block names a piece")
    if kind != "colour" and "hex" in block:
        raise ManifestError(f"{where}: only a colour block has a hex")


def _encode(image: Image.Image, side: int) -> bytes:
    copy = image.copy()
    copy.thumbnail((side, side), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    # No exif/icc arguments: the output carries no metadata from the original file.
    copy.save(buffer, format="WEBP", quality=82, method=6)
    return buffer.getvalue()


def _colour(c: OutfitColour) -> dict[str, Any]:
    return {"hex": c.hex, "name": c.name, "share": c.share, "pieces": list(c.item_ids)}


def _board(entry: dict[str, Any], by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """A board as the demo shows it, with its colour story calculated as the app does."""
    blocks = entry["blocks"]
    story = colour_story(
        [(b["piece"], by_id[b["piece"]]["palette"]) for b in blocks if b["kind"] == "piece"],
        [(index, b["hex"]) for index, b in enumerate(blocks) if b["kind"] == "colour"],
    )
    chosen = {c.block_id: c for c in story.chosen}
    published = []
    for index, block in enumerate(blocks):
        body = (block.get("body") or "").strip() or None
        out: dict[str, Any] = {"kind": block["kind"], "body": body}
        if block["kind"] == "piece":
            out["piece"] = block["piece"]
        if block["kind"] == "colour":
            c = chosen[index]
            out.update(hex=c.hex, name=c.name, family=c.family)
        published.append(out)
    return {
        "id": entry["id"],
        "title": entry["title"],
        "description": entry.get("description"),
        "blocks": published,
        "colour_story": {
            "measured": [_colour(c) for c in story.measured.dominant],
            "chosen": [
                {
                    "block": c.block_id,
                    "hex": c.hex,
                    "name": c.name,
                    "nearest": (
                        {
                            "hex": c.nearest.hex,
                            "name": c.nearest.name,
                            "piece": c.nearest.item_id,
                            "distance": round(c.nearest.distance, 1),
                        }
                        if c.nearest
                        else None
                    ),
                    "on_pieces": c.on_pieces,
                }
                for c in story.chosen
            ],
            "harmony": story.harmony,
        },
    }


def _ai_tags(model: Model, vector: np.ndarray, item_type: str) -> list[dict[str, Any]]:
    return [
        {
            "category": p.category,
            "tag": p.tag,
            "source": "ai",
            "is_guess": vocabulary.BY_NAME[p.category].is_guess,
        }
        for p in model.tagger.predict(vector, item_type)
    ]


def build(
    manifest: dict[str, Any], out: Path, model: Model | None, index: Path | None = None
) -> dict[str, Any]:
    """Compute everything and write it under `out` (and the playground index to `index`, if
    given). Returns the dataset that was written."""
    settings = get_settings()
    (out / "images").mkdir(parents=True, exist_ok=True)
    (out / "thumbs").mkdir(parents=True, exist_ok=True)

    pieces: list[dict[str, Any]] = []
    vectors: dict[str, np.ndarray] = {}
    for entry in manifest["pieces"]:
        with Image.open(entry["path"]) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
        if entry["crop"]:
            left, top, right, bottom = entry["crop"]
            w, h = image.size
            image = image.crop(
                (round(left * w), round(top * h), round(right * w), round(bottom * h))
            )
        result = extract_palette(
            image,
            settings.palette_size,
            # A fabric swatch fills the frame: its "border" is the fabric itself (as in the app).
            detect_background=entry["type"] != ItemType.FABRIC,
        )
        colours = [
            {
                "hex": c.hex,
                "name": c.name,
                "family": c.family,
                "percentage": c.percentage,
                "lab": [round(v, 2) for v in c.lab],
            }
            for c in result.colors
        ]
        tags = list(entry["tags"])
        recorded = {t["category"] for t in tags}
        for tag in tags:
            tag.update(source="recorded", is_guess=False)
        if model is not None:
            vectors[entry["id"]] = model.embedder.embed(image)
            ai = _ai_tags(model, vectors[entry["id"]], entry["type"])
            tags.extend(t for t in ai if t["category"] not in recorded)

        (out / "images" / f"{entry['id']}.webp").write_bytes(_encode(image, IMAGE_SIDE))
        (out / "thumbs" / f"{entry['id']}.webp").write_bytes(_encode(image, THUMB_SIDE))
        shown = image.copy()
        shown.thumbnail((IMAGE_SIDE, IMAGE_SIDE))
        pieces.append(
            {
                "id": entry["id"],
                "title": entry["title"],
                "type": entry["type"],
                "note": entry.get("note"),
                "credit": entry["credit"],
                "licence": entry["licence"],
                "image": f"images/{entry['id']}.webp",
                "thumbnail": f"thumbs/{entry['id']}.webp",
                "width": shown.width,
                "height": shown.height,
                "palette": colours,
                "palette_source": result.source,
                "family": dominant_family(colours),
                "tags": sorted(tags, key=lambda t: (t["category"], t["tag"])),
            }
        )

    by_id = {p["id"]: p for p in pieces}
    for piece in pieces:
        others = [p for p in pieces if p["id"] != piece["id"]]
        by_palette = sorted(
            ((palette_distance(piece["palette"], o["palette"]), o["id"]) for o in others),
        )
        piece["similar_palette"] = [
            {"id": other, "distance": distance} for distance, other in by_palette[:SIMILAR]
        ]
        if vectors:
            mine = vectors[piece["id"]]
            by_look = sorted(
                ((-float(np.dot(mine, vectors[o["id"]])), o["id"]) for o in others),
            )
            piece["similar_look"] = [
                {"id": other, "similarity": round(-score, 3)} for score, other in by_look[:SIMILAR]
            ]
        else:
            piece["similar_look"] = []

    outfits = []
    for entry in manifest["outfits"]:
        colours = outfit_colours([(pid, by_id[pid]["palette"]) for pid in entry["pieces"]])
        outfits.append(
            {
                "id": entry["id"],
                "title": entry["title"],
                "note": entry.get("note"),
                "pieces": entry["pieces"],
                "colours": {
                    "dominant": [_colour(c) for c in colours.dominant],
                    "shared": [_colour(c) for c in colours.shared],
                    "complementary": [[_colour(a), _colour(b)] for a, b in colours.complementary],
                    "contrasting": [[_colour(a), _colour(b)] for a, b in colours.contrasting],
                },
            }
        )

    boards = [_board(entry, by_id) for entry in manifest["boards"]]

    families = Counter(p["family"] for p in pieces if p["family"])
    dataset = {
        "version": FORMAT_VERSION,
        "model": model.embedder.model_name if model else None,
        "vocabulary": vocabulary.VOCABULARY_HASH,
        "pieces": pieces,
        "families": [{"family": f, "pieces": n} for f, n in sorted(families.items())],
        "collections": [
            {
                "id": c["id"],
                "title": c["title"],
                "description": c.get("description"),
                "pieces": c["pieces"],
            }
            for c in manifest["collections"]
        ],
        "outfits": outfits,
        "boards": boards,
    }
    (out / "demo.json").write_text(
        json.dumps(dataset, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n"
    )
    if index is not None:
        write_index(index, dataset, vectors)
    return dataset


def write_index(path: Path, dataset: dict[str, Any], vectors: dict[str, np.ndarray]) -> None:
    """The playground's view of the demo: what it needs to compare a photo, and no more."""
    pieces = [
        {
            "id": p["id"],
            "title": p["title"],
            "type": p["type"],
            "thumbnail": p["thumbnail"],
            "palette": p["palette"],
            # Six decimals keep cosine similarity exact to well under the 0.001 shown.
            "vector": [round(float(v), 6) for v in vectors[p["id"]]] if vectors else None,
        }
        for p in dataset["pieces"]
    ]
    index = {"version": INDEX_VERSION, "model": dataset["model"], "pieces": pieces}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def load_model() -> Model | None:
    try:
        embedder = registry.get_embedder()
    except registry.EmbedderUnavailable as exc:
        print(f"Image model unavailable ({exc}); building without tags or look-alikes.")
        return None
    tagger = registry.get_tagger_if_ready()
    return Model(embedder, tagger) if tagger is not None else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "frontend" / "public" / "demo",
    )
    parser.add_argument("--index", type=Path, default=DEFAULT_INDEX, help="playground index")
    parser.add_argument("--no-model", action="store_true", help="palettes only")
    args = parser.parse_args(argv)
    try:
        manifest = load_manifest(args.manifest)
    except (ManifestError, OSError, json.JSONDecodeError) as exc:
        print(f"Manifest problem: {exc}", file=sys.stderr)
        return 2
    model = None if args.no_model else load_model()
    dataset = build(manifest, args.out, model, args.index)
    print(
        f"Wrote {len(dataset['pieces'])} pieces, {len(dataset['collections'])} collections, "
        f"{len(dataset['outfits'])} outfits and {len(dataset['boards'])} boards to {args.out} "
        f"(model: {dataset['model'] or 'none'})."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
