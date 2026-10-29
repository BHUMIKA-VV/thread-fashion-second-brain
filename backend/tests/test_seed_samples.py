"""The sample seed script: deterministic, rerun-safe, and never touches your own pieces."""

import io
from pathlib import Path

import pytest
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import Item, User
from app.models.enums import ItemType
from app.services.items import ItemService
from app.storage import LocalStorage
from scripts import seed_samples
from scripts.seed_samples import folder_samples, remove, sample_items, seed, synthetic_samples
from tests.images import blocks, encode

pytestmark = pytest.mark.db


@pytest.fixture
def service(db: Session, owner: User, storage: LocalStorage, settings: Settings) -> ItemService:
    return ItemService(db, storage, settings, owner.id)


def count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(Item)) or 0


def test_synthetic_samples_are_deterministic_distinct_and_labelled() -> None:
    first, second = synthetic_samples(), synthetic_samples()
    assert len(first) == 20
    assert [s.data for s in first] == [s.data for s in second]  # same bytes, same hashes
    assert len({s.content_hash for s in first}) == 20
    for sample in first:
        assert sample.item_type == ItemType.FABRIC
        assert "not a photograph" in sample.description
        with Image.open(io.BytesIO(sample.data)) as image:
            assert image.format == "PNG" and image.size == seed_samples.SIZE


def test_seeding_is_safe_to_rerun_and_records_what_each_sample_is(
    service: ItemService, db: Session
) -> None:
    samples = synthetic_samples()[:4]  # four keep the test quick; the logic is per sample
    lines: list[str] = []

    first = seed(service, samples, log=lines.append)
    again = seed(service, samples, log=lines.append)

    assert (first.added, first.skipped, first.failed) == (4, 0, 0)
    assert (again.added, again.skipped, again.failed) == (0, 4, 0)
    assert count(db) == 4
    items = sample_items(service, samples)
    assert all(item.notes and item.notes.startswith("Synthetic sample swatch") for item in items)
    assert all(item.palette is not None for item in items)  # real analysis, not placeholders
    assert sum("skipped" in line for line in lines) == 4


def test_remove_deletes_only_sample_pieces(service: ItemService, db: Session) -> None:
    samples = synthetic_samples()[:3]
    seed(service, samples, log=lambda _: None)
    mine = service.upload(encode(blocks((300, 400), (10, 120, 60), [])), ItemType.GARMENT)
    # Even a piece of yours that mentions samples in its notes is never matched.
    service.items.update(mine.id, notes="Synthetic sample swatch I wrote myself")
    db.commit()

    report = remove(service, samples, log=lambda _: None)

    assert report.removed == 3
    assert [item.id for item in db.scalars(select(Item))] == [mine.id]
    assert remove(service, samples, log=lambda _: None).removed == 0  # nothing left to remove


def test_a_folder_of_your_own_images(tmp_path: Path, service: ItemService, db: Session) -> None:
    (tmp_path / "garment-kurta.png").write_bytes(encode(blocks((300, 400), (200, 30, 40), [])))
    (tmp_path / "outfit_wedding.jpg").write_bytes(
        encode(blocks((300, 400), (30, 60, 180), []), "JPEG")
    )
    (tmp_path / "notes.txt").write_text("not an image")  # ignored: not an image suffix
    (tmp_path / "broken.png").write_bytes(b"not really a png")  # an image suffix, bad content

    samples = list(folder_samples(tmp_path))
    report = seed(service, samples, log=lambda _: None)

    assert sorted(s.filename for s in samples) == [
        "broken.png",
        "garment-kurta.png",
        "outfit_wedding.jpg",
    ]
    assert (report.added, report.failed) == (2, 1)
    types = {item.notes.split("/")[-1].rstrip("."): item.type for item in db.scalars(select(Item))}
    assert types == {"garment-kurta.png": "garment", "outfit_wedding.jpg": "outfit"}


def test_the_script_refuses_to_run_in_production(
    settings: Settings, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    production = settings.model_copy(update={"app_env": "production"})
    monkeypatch.setattr(seed_samples, "get_settings", lambda: production)

    assert seed_samples.main(["--synthetic", "--no-model"]) == 2
    assert "Refusing to seed" in capsys.readouterr().err
