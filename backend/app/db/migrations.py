"""Helpers for running and inspecting Alembic migrations from Python."""

from functools import lru_cache
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

ALEMBIC_INI = Path(__file__).resolve().parents[2] / "alembic.ini"


def alembic_config(url: str | None = None) -> Config:
    """Alembic config; `url` overrides THREAD_DATABASE_URL without writing it to any file."""
    config = Config(str(ALEMBIC_INI))
    config.attributes["configure_logger"] = False
    if url is not None:
        config.attributes["url"] = url
    return config


@lru_cache
def head_revision() -> str | None:
    return ScriptDirectory.from_config(alembic_config()).get_current_head()


def upgrade(url: str, revision: str = "head") -> None:
    command.upgrade(alembic_config(url), revision)


def downgrade(url: str, revision: str = "base") -> None:
    command.downgrade(alembic_config(url), revision)
