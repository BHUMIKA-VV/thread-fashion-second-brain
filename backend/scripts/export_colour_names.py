"""Export Thread's Indian colour names, and the demo pieces that carry each, for the website.

  python -m scripts.export_colour_names [--out ../frontend/src/features/colours/indian-colours.json]

The colour names page at /colours shows the curated Indian reference shades that name measured
colours (app/color/data/indian_colors.json) and, for each, the public demo pieces whose
measured palette has a colour close to it. Closeness uses the app's own CIEDE2000 distance, on
the palettes already published in frontend/public/demo/demo.json, so nothing is estimated
here: a piece is listed only if one of its measured colours, covering at least MIN_SHARE % of
the photo, is within MAX_DISTANCE of the reference. Rerun after rebuilding the demo; a test
checks that the committed file matches.
"""

import argparse
import json
import re
from pathlib import Path
from typing import Any

import numpy as np

from app.color.lab import delta_e_2000, from_hex, srgb_to_lab
from app.color.naming import DATA_DIR, family_for_lab

REPO = Path(__file__).resolve().parents[2]
DEMO = REPO / "frontend" / "public" / "demo" / "demo.json"
DEFAULT_OUT = REPO / "frontend" / "src" / "features" / "colours" / "indian-colours.json"
MAX_DISTANCE = 10.0  # CIEDE2000; about where two swatches stop reading as the same shade
MIN_SHARE = 5.0
MAX_PIECES = 8


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def export(demo: dict[str, Any]) -> dict[str, Any]:
    reference = json.loads((DATA_DIR / "indian_colors.json").read_text(encoding="utf-8"))
    colours = []
    for name, hex_value in reference["colors"]:
        lab = srgb_to_lab(np.array(from_hex(hex_value), dtype=np.float64))
        matches = []
        for piece in demo["pieces"]:
            candidates = [c for c in piece["palette"] if c["percentage"] >= MIN_SHARE]
            if not candidates:
                continue
            distances = delta_e_2000(lab[None, :], np.array([c["lab"] for c in candidates]))
            best = int(np.argmin(distances))
            if float(distances[best]) <= MAX_DISTANCE:
                colour = candidates[best]
                matches.append(
                    {
                        "piece": piece["id"],
                        "hex": colour["hex"],
                        "name": colour["name"],
                        "share": colour["percentage"],
                        "distance": round(float(distances[best]), 1),
                    }
                )
        matches.sort(key=lambda m: (m["distance"], m["piece"]))
        colours.append(
            {
                "name": name,
                "slug": slug(name),
                "hex": hex_value,
                "family": family_for_lab(lab),
                "pieces": matches[:MAX_PIECES],
            }
        )
    return {
        "source": reference["source"],
        "max_distance": MAX_DISTANCE,
        "min_share": MIN_SHARE,
        "colours": colours,
    }


def render(data: dict[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=False, indent=1) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args(argv)
    data = export(json.loads(DEMO.read_text(encoding="utf-8")))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(render(data), encoding="utf-8", newline="\n")
    linked = sum(1 for c in data["colours"] if c["pieces"])
    print(f"Wrote {len(data['colours'])} colours ({linked} with demo pieces) to {args.out}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
