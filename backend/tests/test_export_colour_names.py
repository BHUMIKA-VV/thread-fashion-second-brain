"""The colour names page's data: every Indian reference name, and only demo pieces whose own
measured colours really are close to it."""

import json

import numpy as np

from app.color.lab import delta_e_2000, from_hex, srgb_to_lab
from app.color.naming import DATA_DIR
from scripts import export_colour_names
from scripts.export_colour_names import DEFAULT_OUT, DEMO, MAX_DISTANCE, MIN_SHARE, export, render


def test_the_committed_file_is_current() -> None:
    # Rerun `python -m scripts.export_colour_names` after rebuilding the demo.
    fresh = render(export(json.loads(DEMO.read_text(encoding="utf-8"))))
    assert DEFAULT_OUT.read_text(encoding="utf-8") == fresh


def test_every_reference_name_is_listed_once_in_order() -> None:
    reference = json.loads((DATA_DIR / "indian_colors.json").read_text(encoding="utf-8"))["colors"]
    data = json.loads(DEFAULT_OUT.read_text(encoding="utf-8"))
    assert [(c["name"], c["hex"]) for c in data["colours"]] == [(n, h) for n, h in reference]
    assert len({c["slug"] for c in data["colours"]}) == len(reference)


def test_listed_pieces_have_a_measured_colour_that_close() -> None:
    demo = {p["id"]: p for p in json.loads(DEMO.read_text(encoding="utf-8"))["pieces"]}
    data = json.loads(DEFAULT_OUT.read_text(encoding="utf-8"))
    for colour in data["colours"]:
        reference = srgb_to_lab(np.array(from_hex(colour["hex"]), dtype=np.float64))
        distances = [m["distance"] for m in colour["pieces"]]
        assert distances == sorted(distances)
        for match in colour["pieces"]:
            measured = next(c for c in demo[match["piece"]]["palette"] if c["hex"] == match["hex"])
            assert measured["percentage"] >= MIN_SHARE
            distance = float(delta_e_2000(reference[None, :], np.array([measured["lab"]]))[0])
            assert distance <= MAX_DISTANCE and abs(distance - match["distance"]) < 0.06


def test_a_piece_far_from_every_shade_is_not_listed() -> None:
    far = {
        "id": "far",
        "palette": [{"hex": "#00ff00", "name": "x", "percentage": 100, "lab": [87.7, -86.2, 83.2]}],
    }
    near = {
        "id": "near",
        "palette": [{"hex": "#1c1a1a", "name": "x", "percentage": 60, "lab": [10.0, 1.0, 0.4]}],
    }
    data = export({"pieces": [far, near]})
    kajal = next(c for c in data["colours"] if c["name"] == "kajal black")
    assert [m["piece"] for m in kajal["pieces"]] == ["near"]
    assert all(m["piece"] != "far" for c in data["colours"] for m in c["pieces"])
    assert export_colour_names.slug("Firozi turquoise") == "firozi-turquoise"
