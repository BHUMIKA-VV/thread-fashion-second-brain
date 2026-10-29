"""Filesystem storage rooted at one directory."""

import logging
import os
import time
from pathlib import Path

from app.storage.base import (
    InvalidKeyError,
    ObjectExistsError,
    ObjectNotFoundError,
    StorageError,
    validate_key,
)

logger = logging.getLogger(__name__)

DELETE_ATTEMPTS = 6
DELETE_BACKOFF_SECONDS = 0.05  # 0.05, 0.1, ... => about 0.75 s in total before giving up


class LocalStorage:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def _path(self, key: str) -> Path:
        validate_key(key)
        path = (self.root / key).resolve()
        # Defence in depth: even a valid-looking key must stay inside the root
        # (guards against symlinks or platform path quirks).
        if not path.is_relative_to(self.root):
            raise InvalidKeyError("Invalid storage key.")
        return path

    def save(self, key: str, data: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            # "x" mode = exclusive create: fails instead of overwriting an existing file.
            with path.open("xb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
        except FileExistsError as exc:
            raise ObjectExistsError("Storage object already exists.") from exc
        except OSError as exc:
            path.unlink(missing_ok=True)  # never leave a partially written file behind
            raise StorageError("Could not write file.") from exc

    def read(self, key: str) -> bytes:
        try:
            return self._path(key).read_bytes()
        except FileNotFoundError as exc:
            raise ObjectNotFoundError("Storage object not found.") from exc

    def delete(self, key: str) -> None:
        path = self._path(key)
        # On Windows a file cannot be deleted while another request has it open (e.g. an image
        # being served at the same moment). Such locks last milliseconds, so retry briefly.
        for attempt in range(DELETE_ATTEMPTS):
            try:
                path.unlink(missing_ok=True)
                break
            except PermissionError:
                if attempt == DELETE_ATTEMPTS - 1:
                    raise
                time.sleep(DELETE_BACKOFF_SECONDS * (attempt + 1))
        # Tidy up now-empty per-item directories, never above the root.
        parent = path.parent
        while parent != self.root and parent.is_relative_to(self.root):
            try:
                parent.rmdir()
            except OSError:
                break  # not empty (or in use): stop
            parent = parent.parent

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()
