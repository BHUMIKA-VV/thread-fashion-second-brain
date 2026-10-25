"""Process-wide, lazily loaded embedder.

The model is loaded at most once per process (guarded by a lock) and reused. Nothing here
downloads: if the weights file is missing the embedder is simply "unavailable" and the rest of
the app keeps working (uploads, palettes). Fetch weights with `python -m scripts.fetch_model`.
"""

import contextlib
import logging
import threading
import time
from typing import Literal

from app.core.config import get_settings
from app.ml import model_spec
from app.ml.embedder import Embedder

logger = logging.getLogger(__name__)

State = Literal["disabled", "not_loaded", "loading", "ready", "unavailable", "failed"]


MISSING_WEIGHTS_MESSAGE = (
    "The image model is not installed. Run `python -m scripts.fetch_model` in the backend folder."
)


class EmbedderUnavailable(RuntimeError):
    """No embedder can be used right now; the message says why (safe to show users)."""


class EmbedderLoading(EmbedderUnavailable):
    """The model is loading in the background; ask again in a few seconds."""


LOADING_MESSAGE = "The image model is loading. This can take up to a minute after the app starts."

_lock = threading.Lock()
_loader_lock = threading.Lock()
_loader_started = False
_embedder: Embedder | None = None
_state: State = "not_loaded"
_reason: str | None = None
_load_seconds: float | None = None


def status() -> dict[str, object]:
    """Cheap status for /health. Never loads the model."""
    settings = get_settings()
    weights_present = model_spec.weights_path(settings.model_cache_root).is_file()
    state: State = "disabled" if not settings.embeddings_enabled else _state
    reason = _reason
    if state == "not_loaded" and not weights_present:
        # Known before anyone asks: without weights the model can never load.
        state, reason = "unavailable", MISSING_WEIGHTS_MESSAGE
    return {
        "state": state,
        "model": model_spec.MODEL_NAME,
        "dimension": model_spec.DIMENSION,
        "weights_present": weights_present,
        "load_seconds": _load_seconds,
        "detail": reason
        if state in ("unavailable", "failed")
        else (LOADING_MESSAGE if state == "loading" else None),
    }


def get_embedder_if_ready() -> Embedder | None:
    """The embedder only if already loaded; never waits and never starts a load."""
    return _embedder if get_settings().embeddings_enabled else None


def get_embedder() -> Embedder:
    """The shared embedder, loading it on first use. Raises EmbedderUnavailable."""
    global _embedder, _state, _reason, _load_seconds
    settings = get_settings()
    if not settings.embeddings_enabled:
        raise EmbedderUnavailable("Image similarity is turned off (THREAD_EMBEDDINGS_ENABLED).")
    if _embedder is not None:
        return _embedder
    with _lock:
        if _embedder is not None:
            return _embedder
        weights = model_spec.weights_path(settings.model_cache_root)
        if not weights.is_file():
            _state, _reason = "unavailable", MISSING_WEIGHTS_MESSAGE
            raise EmbedderUnavailable(_reason)
        _state = "loading"
        started = time.perf_counter()
        try:
            from app.ml.embedder import OpenClipEmbedder

            _embedder = OpenClipEmbedder(weights)
        except Exception as exc:
            logger.exception("Loading the image model failed")
            _state, _reason = "failed", "The image model could not be loaded."
            raise EmbedderUnavailable(_reason) from exc
        _load_seconds = round(time.perf_counter() - started, 2)
        _state, _reason = "ready", None
        logger.info("Image model %s loaded in %.1fs", model_spec.MODEL_NAME, _load_seconds)
        return _embedder


def get_embedder_nowait() -> Embedder:
    """For request handlers: the embedder if ready, otherwise never block.

    Loading takes 15-60 s, longer than proxies and users should wait on one request, so while
    it loads this starts (or continues) the background load and raises EmbedderLoading; the
    client retries. Raises EmbedderUnavailable when no model can be loaded at all.
    """
    settings = get_settings()
    if not settings.embeddings_enabled:
        raise EmbedderUnavailable("Image similarity is turned off (THREAD_EMBEDDINGS_ENABLED).")
    if _embedder is not None:
        return _embedder
    if _state == "failed":
        raise EmbedderUnavailable(_reason or "The image model could not be loaded.")
    if not model_spec.weights_path(settings.model_cache_root).is_file():
        raise EmbedderUnavailable(MISSING_WEIGHTS_MESSAGE)
    _start_background_load()
    raise EmbedderLoading(LOADING_MESSAGE)


def _start_background_load() -> None:
    global _loader_started, _state
    with _loader_lock:
        if _loader_started:
            return
        _loader_started = True
        if _state == "not_loaded":
            _state = "loading"

    def load() -> None:
        # Failures are logged inside get_embedder and reported by status().
        with contextlib.suppress(EmbedderUnavailable):
            get_embedder()

    threading.Thread(target=load, name="embedder-load", daemon=True).start()


def warm_up_in_background() -> None:
    """Start loading in a daemon thread if weights exist. Never blocks startup."""
    settings = get_settings()
    if not (settings.embeddings_enabled and settings.embedding_warmup):
        return
    if not model_spec.weights_path(settings.model_cache_root).is_file():
        logger.warning("Image model weights not found; similarity search is unavailable.")
        return
    _start_background_load()


def reset_for_tests() -> None:
    global _embedder, _state, _reason, _load_seconds, _loader_started
    with _lock, _loader_lock:
        _embedder, _state, _reason, _load_seconds = None, "not_loaded", None, None
        _loader_started = False
