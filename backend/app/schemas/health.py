from typing import Literal

from pydantic import BaseModel


class DatabaseHealth(BaseModel):
    status: Literal["ok", "unavailable"]
    server_version: str | None = None
    # Whether the pgvector extension can be installed. The migration in
    # Milestone 2 enables it; here we only check it is present in the image.
    pgvector_available: bool | None = None
    latency_ms: float | None = None


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    app: str
    version: str
    environment: str
    database: DatabaseHealth
