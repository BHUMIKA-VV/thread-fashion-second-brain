import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routeFetch } from "@/test/fetch-router";
import { makeItem, renderWithQuery } from "@/test/render";
import type { Item } from "@/types/api";
import { ITEM_PROCESSING_POLL_MS, ItemDetail } from "./item-detail";

vi.mock("next/navigation", async () => (await import("@/test/navigation-mock")).navigationMock);

afterEach(() => vi.useRealTimers());

function routes(item: () => Item) {
  const id = item().id;
  return routeFetch({
    [`GET /api/items/${id}/tags`]: () =>
      Response.json({ item_id: id, status: "pending", version: null, suggested_type: null, tags: [], removed: [] }),
    [`GET /api/items/${id}/similar`]: () =>
      Response.json({ error: { code: "model_loading", message: "Loading.", details: null } }, { status: 503 }),
    "GET /api/tags/vocabulary": () => Response.json({ version: "v", categories: [] }),
    "GET /api/deep-analysis/status": () =>
      Response.json({ available: false, reason: "not_configured", provider: null, model: null, effort: null, daily_limit: 25, runs_today: 0, sent: [], not_sent: [] }),
    [`GET /api/items/${id}`]: () => Response.json(item()),
  });
}

describe("ItemDetail processing status", () => {
  it("keeps checking while analysis is pending, so the badge updates by itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let item = makeItem({ processing_status: "queued" });
    const fetchMock = routes(() => item);
    renderWithQuery(<ItemDetail id={item.id} />);

    expect(await screen.findByText("Awaiting analysis")).toBeInTheDocument();
    item = { ...item, processing_status: "completed" };
    await vi.advanceTimersByTimeAsync(ITEM_PROCESSING_POLL_MS + 100);

    expect(await screen.findByText("Analysed")).toBeInTheDocument();
    const detailCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === `/api/items/${item.id}`).length;
    const settled = detailCalls();
    await vi.advanceTimersByTimeAsync(ITEM_PROCESSING_POLL_MS * 3);
    expect(detailCalls()).toBe(settled); // stops polling once the status has settled
  });
});
