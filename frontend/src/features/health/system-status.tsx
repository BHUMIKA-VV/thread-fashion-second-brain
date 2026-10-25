"use client";

import { useQuery } from "@tanstack/react-query";
import { Database, Layers, RefreshCw, ScanSearch, Server } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { getHealth } from "@/services/health";
import type { EmbeddingModelHealth } from "@/types/api";

const MODEL_BADGE: Record<EmbeddingModelHealth["state"], { tone: StatusTone; label: string }> = {
  ready: { tone: "success", label: "Ready" },
  loading: { tone: "neutral", label: "Loading" },
  not_loaded: { tone: "idle", label: "Loads on first use" },
  unavailable: { tone: "warning", label: "Not installed" },
  failed: { tone: "danger", label: "Failed to load" },
  disabled: { tone: "idle", label: "Turned off" },
};

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-ink-muted">{icon}</span>
        {label}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
}

/** Live view of GET /health, through the Next.js proxy. */
export function SystemStatus() {
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    refetchInterval: 15_000,
  });

  let apiTone: StatusTone = "neutral";
  let apiLabel = "Checking…";
  if (error) {
    apiTone = "danger";
    apiLabel = "Unreachable";
  } else if (data) {
    apiTone = data.status === "ok" ? "success" : "warning";
    apiLabel = data.status === "ok" ? "Online" : "Degraded";
  }

  const db = data?.database;
  const dbTone: StatusTone = !db ? "neutral" : db.status === "ok" ? "success" : "danger";
  const dbLabel = !db ? (error ? "Unknown" : "Checking…") : db.status === "ok" ? "Connected" : "Unavailable";

  return (
    <section
      aria-labelledby="system-status-title"
      className="rounded-2xl border border-line bg-paper-raised p-6 shadow-soft"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="system-status-title" className="font-display text-xl">
            System status
          </h2>
          <p className="mt-1 text-sm text-ink-muted">Checked every 15 seconds.</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => void refetch()}
          disabled={isFetching}
          aria-label="Check system status now"
        >
          <RefreshCw aria-hidden className={isFetching ? "size-4 animate-spin" : "size-4"} />
          Refresh
        </Button>
      </div>

      <div className="mt-4 divide-y divide-line" aria-live="polite" aria-busy={isPending}>
        <Row icon={<Server className="size-4" aria-hidden />} label="API">
          <StatusBadge tone={apiTone} label={apiLabel} />
          {data && <span className="text-xs text-ink-muted">v{data.version} · {data.environment}</span>}
        </Row>
        <Row icon={<Database className="size-4" aria-hidden />} label="PostgreSQL">
          <StatusBadge tone={dbTone} label={dbLabel} />
          {db?.server_version && (
            <span className="text-xs text-ink-muted">
              v{db.server_version} · {db.latency_ms} ms
            </span>
          )}
        </Row>
        <Row icon={<Database className="size-4" aria-hidden />} label="pgvector extension">
          {db?.pgvector_available == null ? (
            <StatusBadge tone="neutral" label={error ? "Unknown" : "Checking…"} />
          ) : (
            <StatusBadge
              tone={db.pgvector_available ? "success" : "danger"}
              label={db.pgvector_available ? "Available" : "Missing"}
            />
          )}
        </Row>
        <Row icon={<ScanSearch className="size-4" aria-hidden />} label="Image model (similarity)">
          {data ? (
            <>
              <StatusBadge {...MODEL_BADGE[data.embedding_model.state]} />
              {data.embedding_model.state === "ready" && data.embedding_model.load_seconds != null && (
                <span className="text-xs text-ink-muted">
                  {data.embedding_model.dimension}-d · loaded in {data.embedding_model.load_seconds}s
                </span>
              )}
            </>
          ) : (
            <StatusBadge tone="neutral" label={error ? "Unknown" : "Checking…"} />
          )}
        </Row>
        <Row icon={<Layers className="size-4" aria-hidden />} label="Database migrations">
          {db?.schema_up_to_date == null ? (
            <StatusBadge tone="neutral" label={error ? "Unknown" : "Checking…"} />
          ) : (
            <>
              <StatusBadge
                tone={db.schema_up_to_date ? "success" : "warning"}
                label={db.schema_up_to_date ? "Up to date" : "Pending"}
              />
              <span className="font-mono text-xs text-ink-muted">
                {db.schema_revision ?? "none"}
                {!db.schema_up_to_date && db.schema_head ? ` → ${db.schema_head}` : ""}
              </span>
            </>
          )}
        </Row>
      </div>

      {data?.embedding_model.detail && (
        <p className="mt-4 rounded-xl bg-warning/5 px-4 py-3 text-sm text-warning">
          {data.embedding_model.detail}
        </p>
      )}

      {db?.schema_up_to_date === false && (
        <p className="mt-4 rounded-xl bg-warning/5 px-4 py-3 text-sm text-warning">
          The database schema is behind the code. Run{" "}
          <code className="font-mono">alembic upgrade head</code> in the backend folder.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-danger/5 px-4 py-3 text-sm text-danger">
          {error.message} Start it with the backend command in the README, then press Refresh.
        </p>
      )}
    </section>
  );
}
