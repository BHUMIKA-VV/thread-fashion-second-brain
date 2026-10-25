"""Embedder loading rules and preprocessing helpers (no real model, no database)."""

import threading
import time
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app.core.config import Settings, get_settings
from app.ml import embedder as embedder_module
from app.ml import model_spec, registry
from app.ml.embedder import EmbeddingError, l2_normalise, to_rgb_on_white
from tests.fakes import FakeEmbedder


@pytest.fixture
def cache_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """Point the registry at an empty model cache and start from a clean, unloaded state."""
    settings = get_settings().model_copy(update={"model_cache_dir": tmp_path / "models"})
    monkeypatch.setattr(registry, "get_settings", lambda: settings)
    registry.reset_for_tests()
    yield tmp_path / "models"
    registry.reset_for_tests()


def install_dummy_weights(cache_dir: Path) -> Path:
    path = model_spec.weights_path(cache_dir)
    path.parent.mkdir(parents=True)
    path.write_bytes(b"not real weights")
    return path


class CountingEmbedder(FakeEmbedder):
    instances = 0

    def __init__(self, weights: Path, **_: object) -> None:
        super().__init__()
        type(self).instances += 1
        time.sleep(0.05)  # widen the race window for the concurrency test


def test_missing_weights_means_unavailable_and_no_download(
    cache_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def must_not_load(*_: object, **__: object) -> None:
        raise AssertionError("must not try to load (or download) without weights")

    monkeypatch.setattr(embedder_module, "OpenClipEmbedder", must_not_load)

    # Reported as unavailable even before anyone asks for an embedding.
    assert registry.status()["state"] == "unavailable"
    assert "fetch_model" in str(registry.status()["detail"])

    with pytest.raises(registry.EmbedderUnavailable, match="fetch_model"):
        registry.get_embedder()

    status = registry.status()
    assert status["state"] == "unavailable"
    assert status["weights_present"] is False
    assert "fetch_model" in str(status["detail"])
    assert not cache_dir.exists()  # nothing was created, let alone downloaded


def test_model_loads_once_even_with_concurrent_callers(
    cache_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_dummy_weights(cache_dir)
    CountingEmbedder.instances = 0
    monkeypatch.setattr(embedder_module, "OpenClipEmbedder", CountingEmbedder)

    results: list[object] = []
    threads = [
        threading.Thread(target=lambda: results.append(registry.get_embedder())) for _ in range(8)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert CountingEmbedder.instances == 1
    assert len({id(r) for r in results}) == 1
    assert registry.status()["state"] == "ready"
    assert registry.status()["load_seconds"] is not None


def test_load_failure_is_reported_not_raised_raw(
    cache_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_dummy_weights(cache_dir)

    def broken(*_: object, **__: object) -> None:
        raise RuntimeError("corrupt safetensors header")

    monkeypatch.setattr(embedder_module, "OpenClipEmbedder", broken)

    with pytest.raises(registry.EmbedderUnavailable, match="could not be loaded"):
        registry.get_embedder()
    assert registry.status()["state"] == "failed"
    assert "corrupt" not in str(registry.status()["detail"])


def test_disabled_feature(cache_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    disabled = Settings(
        _env_file=None, database_url="postgresql+psycopg://x/y", embeddings_enabled=False
    )  # type: ignore[call-arg]
    monkeypatch.setattr(registry, "get_settings", lambda: disabled)

    with pytest.raises(registry.EmbedderUnavailable, match="turned off"):
        registry.get_embedder()
    assert registry.get_embedder_if_ready() is None
    assert registry.status()["state"] == "disabled"


def test_nowait_starts_one_background_load_and_never_blocks(
    cache_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_dummy_weights(cache_dir)
    CountingEmbedder.instances = 0
    monkeypatch.setattr(embedder_module, "OpenClipEmbedder", CountingEmbedder)

    started = time.perf_counter()
    for _ in range(5):  # several requests arriving while the model loads
        with pytest.raises(registry.EmbedderLoading, match="loading"):
            registry.get_embedder_nowait()
    assert time.perf_counter() - started < 0.04  # none of them waited for the 0.05 s load
    assert registry.status()["state"] in ("loading", "ready")

    deadline = time.time() + 5
    while registry.status()["state"] != "ready" and time.time() < deadline:
        time.sleep(0.02)
    assert registry.get_embedder_nowait() is registry.get_embedder()
    assert CountingEmbedder.instances == 1  # exactly one load, however many requests


def test_nowait_reports_unavailable_not_loading_when_it_can_never_load(
    cache_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with pytest.raises(registry.EmbedderUnavailable) as missing:
        registry.get_embedder_nowait()
    assert not isinstance(missing.value, registry.EmbedderLoading)

    install_dummy_weights(cache_dir)

    def broken(*_: object, **__: object) -> None:
        raise RuntimeError("bad weights")

    monkeypatch.setattr(embedder_module, "OpenClipEmbedder", broken)
    with pytest.raises(registry.EmbedderUnavailable):
        registry.get_embedder()  # the load fails...
    with pytest.raises(registry.EmbedderUnavailable) as failed:
        registry.get_embedder_nowait()  # ...so requests are told, not asked to retry forever
    assert not isinstance(failed.value, registry.EmbedderLoading)


def test_if_ready_never_starts_a_load(cache_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    install_dummy_weights(cache_dir)
    CountingEmbedder.instances = 0
    monkeypatch.setattr(embedder_module, "OpenClipEmbedder", CountingEmbedder)

    assert registry.get_embedder_if_ready() is None
    assert CountingEmbedder.instances == 0
    assert registry.status()["state"] == "not_loaded"


def test_warm_up_runs_in_the_background_only_when_weights_exist(
    cache_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    CountingEmbedder.instances = 0
    monkeypatch.setattr(embedder_module, "OpenClipEmbedder", CountingEmbedder)
    settings = registry.get_settings().model_copy(update={"embedding_warmup": True})
    monkeypatch.setattr(registry, "get_settings", lambda: settings)

    registry.warm_up_in_background()  # no weights: does nothing
    time.sleep(0.2)
    assert CountingEmbedder.instances == 0

    install_dummy_weights(cache_dir)
    registry.warm_up_in_background()
    deadline = time.time() + 5
    while registry.status()["state"] != "ready" and time.time() < deadline:
        time.sleep(0.02)
    assert CountingEmbedder.instances == 1


# --- preprocessing helpers ---------------------------------------------------------------


def test_transparency_is_flattened_onto_white() -> None:
    image = Image.new("RGBA", (4, 4), (255, 0, 0, 0))
    image.putpixel((0, 0), (0, 0, 255, 255))

    flat = to_rgb_on_white(image)

    assert flat.mode == "RGB"
    assert flat.getpixel((1, 1)) == (255, 255, 255)
    assert flat.getpixel((0, 0)) == (0, 0, 255)
    assert to_rgb_on_white(Image.new("L", (2, 2), 128)).getpixel((0, 0)) == (128, 128, 128)


def test_l2_normalise() -> None:
    vector = l2_normalise(np.array([3.0, 4.0]))
    assert vector.dtype == np.float32
    assert np.allclose(vector, [0.6, 0.8])
    with pytest.raises(EmbeddingError):
        l2_normalise(np.zeros(3))
    with pytest.raises(EmbeddingError):
        l2_normalise(np.array([np.nan, 1.0]))


def test_model_identifier_pins_everything_that_affects_vectors() -> None:
    name = model_spec.MODEL_NAME
    assert model_spec.ARCHITECTURE in name and model_spec.PRETRAINED_TAG in name
    assert model_spec.HF_REVISION[:7] in name and name.endswith("/pp1")
    assert model_spec.DIMENSION == 512
    assert len(name) <= 100  # embeddings.model_name column width
