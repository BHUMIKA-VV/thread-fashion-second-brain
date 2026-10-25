import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { HealthResponse } from "@/types/api";
import { SystemStatus } from "./system-status";

function renderWithQuery() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SystemStatus />
    </QueryClientProvider>,
  );
}

const healthy: HealthResponse = {
  status: "ok",
  app: "Thread API",
  version: "0.1.0",
  environment: "development",
  database: {
    status: "ok",
    server_version: "16.9",
    pgvector_available: true,
    latency_ms: 2.1,
    schema_revision: "abc123",
    schema_head: "abc123",
    schema_up_to_date: true,
  },
  embedding_model: {
    state: "ready",
    model: "open_clip/ViT-B-32/laion2b_s34b_b79k@1a25a44/pp1",
    dimension: 512,
    weights_present: true,
    load_seconds: 15.2,
    detail: null,
  },
};

const unavailableDb: HealthResponse["database"] = {
  status: "unavailable",
  server_version: null,
  pgvector_available: null,
  latency_ms: null,
  schema_revision: null,
  schema_head: null,
  schema_up_to_date: null,
};

describe("SystemStatus", () => {
  it("shows a connected database when the API is healthy", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(healthy));
    renderWithQuery();

    expect(await screen.findByText("Online")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.getByText("Up to date")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("512-d · loaded in 15.2s")).toBeInTheDocument();
  });

  it("explains a missing image model without marking the API degraded", async () => {
    const noModel: HealthResponse = {
      ...healthy,
      embedding_model: {
        ...healthy.embedding_model,
        state: "unavailable",
        weights_present: false,
        load_seconds: null,
        detail: "The image model is not installed. Run `python -m scripts.fetch_model` in the backend folder.",
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(noModel));
    renderWithQuery();

    expect(await screen.findByText("Online")).toBeInTheDocument();
    expect(screen.getByText("Not installed")).toBeInTheDocument();
    expect(screen.getByText(/fetch_model/)).toBeInTheDocument();
  });

  it("flags pending migrations with the command to run", async () => {
    const behind: HealthResponse = {
      ...healthy,
      status: "degraded",
      database: { ...healthy.database, schema_revision: null, schema_up_to_date: false },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(behind, { status: 503 }));
    renderWithQuery();

    expect(await screen.findByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("alembic upgrade head")).toBeInTheDocument();
  });

  it("shows a degraded API when the database is down (503 with body)", async () => {
    const degraded: HealthResponse = { ...healthy, status: "degraded", database: unavailableDb };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(degraded, { status: 503 }));
    renderWithQuery();

    expect(await screen.findByText("Degraded")).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("explains when the API cannot be reached", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Internal Server Error", { status: 500 }));
    renderWithQuery();

    expect(await screen.findByText("Unreachable")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The Thread API is not reachable.");
  });
});
