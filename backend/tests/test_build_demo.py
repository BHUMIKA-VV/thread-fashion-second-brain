"""The demo dataset builder: computed by the app's own code, static, and free of metadata."""

import json
from pathlib import Path
from typing import Any

import pytest
from PIL import Image

from app.ml import vocabulary
from scripts import build_demo
from scripts.build_demo import ManifestError, build, load_manifest, load_model


def write_image(path: Path, colour: tuple[int, int, int], *, gps: bool = False) -> None:
    image = Image.new("RGB", (1500, 2000), colour)  # larger than IMAGE_SIDE: it is scaled down
    image.paste((240, 236, 228), (0, 0, 1500, 300))  # a light band, so palettes have two colours
    exif = Image.Exif()
    exif[0x010F] = "Camera maker"  # Make
    if gps:
        exif[0x8825] = {2: (12.0, 58.0, 0.0)}  # GPS latitude
    image.save(path, format="JPEG", exif=exif.tobytes())


def piece(pid: str, **extra: Any) -> dict[str, Any]:
    return {
        "id": pid,
        "file": f"{pid}.jpg",
        "type": "garment",
        "title": pid.replace("-", " ").title(),
        "credit": "Test photograph",
        "licence": "Own photograph",
        **extra,
    }


@pytest.fixture
def folder(tmp_path: Path) -> Path:
    write_image(tmp_path / "indigo-kurta.jpg", (40, 50, 110), gps=True)
    write_image(tmp_path / "navy-shirt.jpg", (35, 45, 100))
    write_image(tmp_path / "rust-scarf.jpg", (170, 70, 40))
    manifest = {
        "pieces": [
            piece("indigo-kurta", tags=[{"category": "weave", "tag": "twill"}]),
            piece("navy-shirt"),
            piece("rust-scarf", type="accessory"),
        ],
        "collections": [{"id": "everyday", "title": "Everyday", "pieces": ["navy-shirt"]}],
        "outfits": [{"id": "office", "title": "Office", "pieces": ["navy-shirt", "rust-scarf"]}],
    }
    (tmp_path / "demo.json").write_text(json.dumps(manifest), encoding="utf-8")
    return tmp_path


def run(folder: Path, out: Path, *, with_model: bool = True) -> dict[str, Any]:
    manifest = load_manifest(folder / "demo.json")
    return build(manifest, out, load_model() if with_model else None)


def test_builds_palettes_tags_similarity_and_outfits(folder: Path, tmp_path: Path) -> None:
    data = run(folder, tmp_path / "out")
    assert data["model"] == "fake/colour-layout/pp1"
    assert data["vocabulary"] == vocabulary.VOCABULARY_HASH
    by_id = {p["id"]: p for p in data["pieces"]}
    kurta = by_id["indigo-kurta"]
    assert kurta["palette"] and kurta["family"] == "blue"
    assert abs(sum(c["percentage"] for c in kurta["palette"]) - 100) < 1
    # Closest palette to the indigo kurta is the navy shirt, not the rust scarf.
    assert kurta["similar_palette"][0]["id"] == "navy-shirt"
    assert kurta["similar_look"][0]["id"] == "navy-shirt"
    assert all(s["id"] != "indigo-kurta" for s in kurta["similar_look"])
    outfit = data["outfits"][0]
    assert outfit["pieces"] == ["navy-shirt", "rust-scarf"]
    assert outfit["colours"]["dominant"]
    assert {f["family"] for f in data["families"]} >= {"blue"}
    written = json.loads((tmp_path / "out" / "demo.json").read_text(encoding="utf-8"))
    assert written == data


def test_recorded_tags_replace_suggestions_and_guesses_are_marked(
    folder: Path, tmp_path: Path
) -> None:
    data = run(folder, tmp_path / "out")
    for p in data["pieces"]:
        for tag in p["tags"]:
            assert tag["source"] in {"ai", "recorded"}
            if tag["source"] == "ai":
                assert tag["category"] != "weave"  # never suggested by the model
                assert tag["is_guess"] == vocabulary.BY_NAME[tag["category"]].is_guess
    kurta = next(p for p in data["pieces"] if p["id"] == "indigo-kurta")
    weave = [t for t in kurta["tags"] if t["category"] == "weave"]
    assert weave == [{"category": "weave", "tag": "twill", "source": "recorded", "is_guess": False}]


def test_images_are_resized_webp_without_metadata(folder: Path, tmp_path: Path) -> None:
    data = run(folder, tmp_path / "out")
    kurta = next(p for p in data["pieces"] if p["id"] == "indigo-kurta")
    with Image.open(tmp_path / "out" / kurta["image"]) as image:
        assert image.format == "WEBP"
        assert max(image.size) == build_demo.IMAGE_SIDE
        assert (image.width, image.height) == (kurta["width"], kurta["height"])
        assert not image.getexif()
        assert "exif" not in image.info and "icc_profile" not in image.info
    with Image.open(tmp_path / "out" / kurta["thumbnail"]) as thumb:
        assert max(thumb.size) == build_demo.THUMB_SIDE


def test_crop_trims_what_is_measured_and_shown(folder: Path, tmp_path: Path) -> None:
    path = folder / "demo.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    manifest["pieces"][0]["crop"] = [0, 0.25, 1, 1]  # drops the light band at the top
    path.write_text(json.dumps(manifest), encoding="utf-8")
    data = run(folder, tmp_path / "out")
    kurta = next(p for p in data["pieces"] if p["id"] == "indigo-kurta")
    assert len(kurta["palette"]) == 1 and kurta["family"] == "blue"
    assert (kurta["width"], kurta["height"]) == (1500, 1500)  # the crop, under IMAGE_SIDE
    with Image.open(tmp_path / "out" / kurta["image"]) as image:
        assert image.size == (1500, 1500)


def test_same_inputs_give_the_same_files(folder: Path, tmp_path: Path) -> None:
    run(folder, tmp_path / "a")
    run(folder, tmp_path / "b")
    for name in ("demo.json", "images/navy-shirt.webp", "thumbs/rust-scarf.webp"):
        assert (tmp_path / "a" / name).read_bytes() == (tmp_path / "b" / name).read_bytes()


def test_without_the_model_only_palettes_are_computed(folder: Path, tmp_path: Path) -> None:
    data = run(folder, tmp_path / "out", with_model=False)
    assert data["model"] is None
    for p in data["pieces"]:
        assert p["similar_look"] == []
        assert all(t["source"] == "recorded" for t in p["tags"])
        assert p["similar_palette"]


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda m: m["pieces"][0].pop("licence"), "'licence' is required"),
        (lambda m: m["pieces"][1].update(id="indigo-kurta"), "used twice"),
        (lambda m: m["pieces"][0].update(id="Indigo Kurta"), "lowercase"),
        (lambda m: m["pieces"][0].update(type="shoe"), "unknown type"),
        (lambda m: m["pieces"][0].update(file="missing.jpg"), "not found"),
        (lambda m: m["pieces"][0].update(tags=[{"category": "weave", "tag": "x"}]), "not a weave"),
        (lambda m: m["outfits"][0]["pieces"].append("ghost"), "unknown pieces ghost"),
        (lambda m: m.update(pieces=[]), "at least one piece"),
        (lambda m: m["pieces"][0].update(crop=[0, 0, 1]), r"crop must be \[left"),
        (lambda m: m["pieces"][0].update(crop=[0.5, 0, 0.4, 1]), "left < right"),
    ],
)
def test_bad_manifests_are_refused(folder: Path, change: Any, message: str) -> None:
    path = folder / "demo.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    change(manifest)
    path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(ManifestError, match=message):
        load_manifest(path)


def test_main_reports_manifest_problems(folder: Path, tmp_path: Path) -> None:
    (folder / "demo.json").write_text("{}", encoding="utf-8")
    assert build_demo.main(["--manifest", str(folder / "demo.json"), "--out", str(tmp_path)]) == 2
