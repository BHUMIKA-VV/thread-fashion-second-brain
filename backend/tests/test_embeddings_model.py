"""Integration tests with the REAL OpenCLIP weights. Skipped when they are not installed
(fetch them with `python -m scripts.fetch_model`)."""

import numpy as np
import pytest
from PIL import Image

from app.core.config import get_settings
from app.ml import model_spec, registry

pytestmark = pytest.mark.ml

if not model_spec.weights_path(get_settings().model_cache_root).is_file():
    pytest.skip("OpenCLIP weights not installed", allow_module_level=True)


@pytest.fixture(scope="module")
def loaded():  # noqa: ANN201
    """The real embedder and tagger, loaded once per module (the per-test fixture resets the
    registry, so tests use these references rather than the registry's slots)."""
    registry.reset_for_tests()
    embedder = registry.get_embedder()
    return embedder, registry.get_tagger_if_ready()


@pytest.fixture
def model(loaded):  # noqa: ANN001, ANN201
    return loaded[0]


@pytest.fixture
def tagger(loaded):  # noqa: ANN001, ANN201
    return loaded[1]


def garment(colour: tuple[int, int, int], size: tuple[int, int] = (600, 800)) -> Image.Image:
    image = Image.new("RGB", size, (240, 240, 240))
    image.paste(colour, (size[0] // 5, size[1] // 8, size[0] * 4 // 5, size[1] * 7 // 8))
    return image


def test_real_model_produces_unit_length_512_d_vectors(model) -> None:  # noqa: ANN001
    vector = model.embed(garment((200, 30, 40)))

    assert model.model_name == model_spec.MODEL_NAME
    assert vector.shape == (512,) and vector.dtype == np.float32
    assert np.linalg.norm(vector) == pytest.approx(1.0, abs=1e-5)


def test_real_model_is_repeatable(model) -> None:  # noqa: ANN001
    image = garment((30, 60, 180))
    assert np.array_equal(model.embed(image), model.embed(image.copy()))


def test_transparent_input_matches_its_flattened_version(model) -> None:  # noqa: ANN001
    rgba = garment((107, 124, 42)).convert("RGBA")
    flattened = garment((107, 124, 42))
    assert np.allclose(model.embed(rgba), model.embed(flattened), atol=1e-6)


def test_real_model_ranks_a_close_variant_above_a_different_image(model) -> None:  # noqa: ANN001
    red = model.embed(garment((200, 30, 40)))
    red_variant = model.embed(garment((185, 45, 50), size=(500, 700)))
    blue = model.embed(garment((30, 60, 180)))
    noise = model.embed(Image.effect_noise((600, 800), 90).convert("RGB"))

    assert float(red @ red_variant) > float(red @ blue) > float(red @ noise)


# --- zero-shot tagging with the real text encoder ---------------------------------------------


def stripes() -> Image.Image:
    from PIL import ImageDraw

    image = Image.new("RGB", (600, 800), (245, 240, 230))
    draw = ImageDraw.Draw(image)
    for x in range(0, 600, 60):
        draw.rectangle((x, 0, x + 29, 799), fill=(38, 59, 94))
    return image


def test_real_tagger_is_cached_versioned_and_deterministic(model, tagger) -> None:  # noqa: ANN001
    from app.ml.tagging import cache_key, text_cache_dir

    assert tagger is not None and tagger.model_name == model.model_name
    cache = (
        text_cache_dir(get_settings().model_cache_root) / f"text-{cache_key(model.model_name)}.npz"
    )
    assert cache.is_file()
    vector = model.embed(stripes())
    first, second = tagger.predict(vector), tagger.predict(vector.copy())
    assert first == second
    assert all(0 <= p.score <= 1 for p in first)


def test_real_tagger_sanity_on_an_obvious_pattern(model, tagger) -> None:  # noqa: ANN001
    """Smoke test only (one synthetic image), not an accuracy measurement."""
    assert tagger is not None
    pattern_scores = tagger.scores(model.embed(stripes()))["pattern"]
    assert pattern_scores[0].tag == "striped"
