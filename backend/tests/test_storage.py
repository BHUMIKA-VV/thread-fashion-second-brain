import uuid
from pathlib import Path

import pytest

from app.storage import LocalStorage, item_key
from app.storage.base import InvalidKeyError, ObjectExistsError, ObjectNotFoundError


@pytest.fixture
def storage(tmp_path: Path) -> LocalStorage:
    return LocalStorage(tmp_path / "root")


def test_save_read_delete_round_trip(storage: LocalStorage) -> None:
    key = item_key(uuid.uuid4(), uuid.uuid4(), "original.jpg")

    storage.save(key, b"abc")
    assert storage.exists(key)
    assert storage.read(key) == b"abc"

    storage.delete(key)
    assert not storage.exists(key)
    storage.delete(key)  # idempotent
    # Empty per-item folders are tidied away, but the root itself stays.
    assert storage.root.is_dir() and not any(storage.root.iterdir())


def test_never_overwrites(storage: LocalStorage) -> None:
    key = item_key(uuid.uuid4(), uuid.uuid4(), "original.png")
    storage.save(key, b"first")

    with pytest.raises(ObjectExistsError):
        storage.save(key, b"second")
    assert storage.read(key) == b"first"


def test_missing_object(storage: LocalStorage) -> None:
    with pytest.raises(ObjectNotFoundError):
        storage.read("users/x/items/y/original.jpg")


@pytest.mark.parametrize(
    "key",
    [
        "../outside.txt",
        "users/../../outside.txt",
        "/etc/passwd",
        "C:/Windows/win.ini",
        "C:\\Windows\\win.ini",
        "users\\..\\..\\x",
        "users//x",
        "users/./x",
        "users/x/",
        "Users/Mixed/Case",
        "users/x/file name.jpg",
        "",
        "%2e%2e/secret",
    ],
)
def test_unsafe_keys_are_rejected(storage: LocalStorage, key: str, tmp_path: Path) -> None:
    (tmp_path / "outside.txt").write_text("secret")

    for operation in (
        lambda: storage.save(key, b"x"),
        lambda: storage.read(key),
        lambda: storage.delete(key),
        lambda: storage.exists(key),
    ):
        with pytest.raises(InvalidKeyError):
            operation()
    assert (tmp_path / "outside.txt").read_text() == "secret"


def test_item_keys_are_server_generated_and_valid() -> None:
    user, item = uuid.uuid4(), uuid.uuid4()
    assert item_key(user, item, "thumbnail.webp") == f"users/{user}/items/{item}/thumbnail.webp"
    with pytest.raises(InvalidKeyError):
        item_key(user, item, "../escape.jpg")
