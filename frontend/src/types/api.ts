// Mirrors backend/app/schemas. Keep in sync when the API changes.

export type ApiErrorBody = {
  error: { code: string; message: string; details: unknown };
};

export type DatabaseHealth = {
  status: "ok" | "unavailable";
  server_version: string | null;
  pgvector_available: boolean | null;
  latency_ms: number | null;
  schema_revision: string | null;
  schema_head: string | null;
  schema_up_to_date: boolean | null;
};

export type HealthResponse = {
  status: "ok" | "degraded";
  app: string;
  version: string;
  environment: string;
  database: DatabaseHealth;
};
