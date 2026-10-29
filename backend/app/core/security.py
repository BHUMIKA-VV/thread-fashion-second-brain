"""Password hashing and opaque tokens.

Passwords are hashed with argon2id (argon2-cffi's defaults, which follow RFC 9106's
recommendations). Session and email tokens are 256-bit random strings; only their SHA-256
hashes are stored, so they are compared by hash lookup, never by string comparison.
"""

import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

PASSWORD_MIN = 12
# argon2 hashes any length, but a megabyte "password" is a cheap way to burn server CPU.
PASSWORD_MAX = 128

_hasher = PasswordHasher()
# Checked when an email has no account, so a failed sign-in takes as long either way.
_DUMMY_HASH = _hasher.hash("thread-timing-equaliser")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    """True if `password` matches. A missing hash still costs one verification."""
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()
