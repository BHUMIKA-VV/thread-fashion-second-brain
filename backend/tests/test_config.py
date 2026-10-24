import pytest

from app.core.config import Settings, get_settings
from app.db.session import get_engine

THREAD_URL = "postgresql+psycopg://thread:pw@127.0.0.1:5434/thread"
FOREIGN_URL = "postgresql+asyncpg://other:pw@localhost:5433/order_supervisor"


def test_unprefixed_database_url_is_ignored(monkeypatch: pytest.MonkeyPatch) -> None:
    """Another project's machine-wide DATABASE_URL must not change Thread's database."""
    monkeypatch.setenv("DATABASE_URL", FOREIGN_URL)
    monkeypatch.setenv("THREAD_DATABASE_URL", THREAD_URL)

    settings = Settings(_env_file=None)  # type: ignore[call-arg]

    assert settings.database_url == THREAD_URL


def test_database_url_is_required_with_prefix(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", FOREIGN_URL)
    monkeypatch.delenv("THREAD_DATABASE_URL", raising=False)

    with pytest.raises(ValueError, match="database_url"):
        Settings(_env_file=None)  # type: ignore[call-arg]


def test_engine_uses_psycopg_driver_from_real_configuration() -> None:
    """End-to-end over the real settings loader (env + .env) and SQLAlchemy."""
    get_settings.cache_clear()
    get_engine.cache_clear()
    try:
        engine = get_engine()
        assert engine.dialect.driver == "psycopg"
        assert engine.url.database == "thread"
    finally:
        get_engine.cache_clear()
