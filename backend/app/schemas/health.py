from typing import Literal

from pydantic import BaseModel


class DatabaseHealth(BaseModel):
    status: Literal["ok", "unavailable"]
    server_version: str | None = None
    # Whether the pgvector extension can be installed (the migration enables it).
    pgvector_available: bool | None = None
    latency_ms: float | None = None
    # Alembic revision applied to the database vs. the newest revision in the code.
    schema_revision: str | None = None
    schema_head: str | None = None
    schema_up_to_date: bool | None = None


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    app: str
    version: str
    environment: str
    database: DatabaseHealth
