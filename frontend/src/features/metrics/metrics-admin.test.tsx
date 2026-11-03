import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { routeFetch } from "@/test/fetch-router";
import { renderWithQuery } from "@/test/render";
import type { Me, MetricsSummary } from "@/types/api";
import { MetricsAdmin } from "./metrics-admin";

vi.mock("next/navigation", async () => (await import("@/test/navigation-mock")).navigationMock);

const owner: Me = {
  id: "o",
  display_name: "Owner",
  email: "owner@example.com",
  email_verified: true,
  is_owner: true,
  has_password: true,
};

const summary = (days: number): MetricsSummary => ({
  days,
  since: "2026-10-05",
  events: { landing_view: 120, demo_view: 41, pilot_view: 9 },
  sources: [
    { source: "search", total: 80, events: { landing_view: 70, demo_view: 10 } },
    { source: "ref:insta-nov", total: 30, events: { landing_view: 20, demo_view: 10 } },
  ],
  funnel: { signups: 6, confirmed: 5, added_a_piece: 3, wardrobe_interest: 2, studio_interest: 1 },
});

describe("MetricsAdmin", () => {
  it("shows nothing to an account that isn't the owner", async () => {
    routeFetch({ "GET /api/auth/session": () => Response.json({ ...owner, is_owner: false }) });
    const { container } = renderWithQuery(<MetricsAdmin />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it("shows page totals, outcomes and sources, and changes the period", async () => {
    const fetch = routeFetch({
      "GET /api/auth/session": () => Response.json(owner),
      "GET /api/admin/metrics": ({ url }) => Response.json(summary(Number(new URL(url, "http://x").searchParams.get("days")))),
    });
    renderWithQuery(<MetricsAdmin />);

    const pages = await screen.findByLabelText("Page visits");
    expect(within(pages).getByText("Landing page").nextSibling).toHaveTextContent("120");
    expect(within(pages).getByText("How it works").nextSibling).toHaveTextContent("0");
    expect(within(screen.getByLabelText("Outcomes")).getByText("Added a piece").nextSibling).toHaveTextContent("3");
    expect(screen.getByRole("rowheader", { name: "Search engines" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Link tagged “insta-nov”" })).toBeInTheDocument();
    expect(screen.getByText(/daily totals, not people/)).toBeInTheDocument();
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith("/admin/metrics?days=30"))).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    await vi.waitFor(() =>
      expect(fetch.mock.calls.some(([url]) => String(url).endsWith("/admin/metrics?days=7"))).toBe(true),
    );
    expect(screen.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
  });
});
