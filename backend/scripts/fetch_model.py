"""Download the pinned OpenCLIP weights into the project's model cache (explicit, one-off).

    cd backend
    .venv/Scripts/python -m scripts.fetch_model

Fetches exactly one file (~577 MiB) from a pinned Hugging Face revision, verifies its SHA-256,
and stores it under THREAD_MODEL_CACHE_DIR (default <repo>/.cache/models). All Hugging Face
client caches for this process are pointed inside that folder too, so nothing is written to the
user-wide cache. Global environment settings are not changed.
"""

import hashlib
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

from app.core.config import get_settings
from app.ml import model_spec


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    cache_root = get_settings().model_cache_root
    target = model_spec.weights_path(cache_root)
    if target.is_file() and sha256_of(target) == model_spec.WEIGHTS_SHA256:
        print(f"Already present and verified: {target}")
        return 0

    # Confine every Hugging Face cache for THIS process to the project folder.
    hf_home = cache_root / "huggingface"
    os.environ["HF_HOME"] = str(hf_home)
    os.environ["HF_XET_CACHE"] = str(hf_home / "xet")
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    from huggingface_hub import hf_hub_download  # import after the env is set

    target.parent.mkdir(parents=True, exist_ok=True)
    print(
        f"Downloading {model_spec.HF_REPO}@{model_spec.HF_REVISION[:7]}/{model_spec.WEIGHTS_FILE}"
        f" ({model_spec.WEIGHTS_BYTES / 1024**2:.1f} MiB) -> {target}"
    )
    started = time.perf_counter()
    with tempfile.TemporaryDirectory(dir=cache_root) as staging:
        downloaded = Path(
            hf_hub_download(
                repo_id=model_spec.HF_REPO,
                filename=model_spec.WEIGHTS_FILE,
                revision=model_spec.HF_REVISION,
                local_dir=staging,
            )
        )
        actual = sha256_of(downloaded)
        if actual != model_spec.WEIGHTS_SHA256:
            print(f"Checksum mismatch: expected {model_spec.WEIGHTS_SHA256}, got {actual}")
            return 1
        shutil.move(str(downloaded), target)
    print(f"Verified SHA-256 and saved in {time.perf_counter() - started:.0f}s: {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
