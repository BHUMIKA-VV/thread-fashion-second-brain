"""Application settings, loaded from environment variables and the repo-root .env file."""

from functools import lru_cache
from pathlib import Path
from typing import Literal
from uuid import UUID

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Prefixed so generic machine-wide variables (e.g. another project's DATABASE_URL)
        # can never leak into Thread. THREAD_DATABASE_URL -> database_url.
        env_prefix="THREAD_",
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Thread API"
    app_version: str = "0.1.0"
    app_env: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"

    database_url: str = Field(
        description="SQLAlchemy URL, e.g. postgresql+psycopg://user:pass@host:5434/thread",
    )
    test_database_url: str | None = None

    # Local MVP ownership: every request acts as this one user. This is NOT authentication;
    # the app refuses to use it when app_env is "production" (see app/api/deps.py).
    dev_user_id: UUID = UUID("00000000-0000-4000-8000-000000000001")
    dev_user_name: str = "Local developer"

    # Read by the Next.js proxy; declared here so the shared .env is self-documenting.
    api_url: str = "http://127.0.0.1:8010"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from the environment
