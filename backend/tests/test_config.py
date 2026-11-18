import pytest
from sqlalchemy import make_url

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


SAFE_PRODUCTION = {
    "cookie_secure": True,
    "public_url": "https://thread.example",
    "allowed_origins": "https://thread.example",
    "mail_provider": "resend",
    "resend_api_key": "re_test_key",
}


def test_without_thread_app_env_the_settings_are_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """P0 (M15-0): a deployment that forgets THREAD_APP_ENV must not run as development."""
    monkeypatch.delenv("THREAD_APP_ENV", raising=False)
    monkeypatch.setenv("THREAD_DATABASE_URL", THREAD_URL)

    settings = Settings(_env_file=None, **SAFE_PRODUCTION)  # type: ignore[call-arg,arg-type]

    assert settings.app_env == "production"


def test_a_deployment_without_thread_app_env_and_unsafe_settings_refuses_to_start(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("THREAD_APP_ENV", raising=False)
    monkeypatch.setenv("THREAD_DATABASE_URL", THREAD_URL)

    with pytest.raises(ValueError, match="Unsafe production settings") as refused:
        Settings(_env_file=None)  # type: ignore[call-arg]
    assert "THREAD_COOKIE_SECURE must be true" in str(refused.value)
    assert "THREAD_APP_ENV=development" in str(refused.value)  # says how to work locally


@pytest.mark.parametrize("value", ["prod", "dev", "Production", "staging", ""])
def test_an_unknown_thread_app_env_refuses_to_start(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    monkeypatch.setenv("THREAD_APP_ENV", value)
    monkeypatch.setenv("THREAD_DATABASE_URL", THREAD_URL)

    with pytest.raises(ValueError, match="app_env"):
        Settings(_env_file=None, **SAFE_PRODUCTION)  # type: ignore[call-arg,arg-type]


def test_engine_uses_psycopg_driver_from_real_configuration() -> None:
    """End-to-end over the real settings loader (env + .env) and SQLAlchemy."""
    get_settings.cache_clear()
    get_engine.cache_clear()
    try:
        engine = get_engine()
        assert engine.dialect.driver == "psycopg"
        # The configured database, whatever it is called (default setups use "thread").
        assert engine.url.database == make_url(get_settings().database_url).database
    finally:
        get_engine.cache_clear()
