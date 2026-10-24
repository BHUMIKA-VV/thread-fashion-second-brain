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
  database: { status: "ok", server_version: "16.9", pgvector_available: true, latency_ms: 2.1 },
};

describe("SystemStatus", () => {
  it("shows a connected database when the API is healthy", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(healthy));
    renderWithQuery();

    expect(await screen.findByText("Online")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
  });

  it("shows a degraded API when the database is down (503 with body)", async () => {
    const degraded: HealthResponse = {
      ...healthy,
      status: "degraded",
      database: { status: "unavailable", server_version: null, pgvector_available: null, latency_ms: null },
    };
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
