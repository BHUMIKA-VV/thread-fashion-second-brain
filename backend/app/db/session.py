"""Database engine and session factory.

The engine is created lazily so importing the app (e.g. for OpenAPI generation or
unit tests) does not require a running database.
"""

import logging
from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

logger = logging.getLogger(__name__)


@lru_cache
def get_engine() -> Engine:
    engine = create_engine(
        get_settings().database_url,
        pool_pre_ping=True,
        # Fail fast when the database is down instead of hanging the request.
        connect_args={"connect_timeout": 3},
    )
    # Driver and database name only: never log the URL, host credentials or password.
    logger.info(
        "Database engine created (driver=%s, database=%s)",
        engine.dialect.driver,
        engine.url.database,
    )
    return engine


@lru_cache
def get_session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency that yields one session per request."""
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()
