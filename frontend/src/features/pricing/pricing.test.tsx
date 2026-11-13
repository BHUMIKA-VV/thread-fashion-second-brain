import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiErrorResponse, routeFetch } from "@/test/fetch-router";
import { renderWithQuery } from "@/test/render";
import type { PlanCatalogue } from "@/types/api";

import { formatPeriod, formatPrice, formatStorage } from "./format";
import { Pricing } from "./pricing";

const MB = 1024 ** 2;
const PUBLIC = ["demo", "playground"];
const STUDIO = [...PUBLIC, "archive", "boards"];

function catalogue(overrides: Partial<PlanCatalogue> = {}, studioPrice = 99_900): PlanCatalogue {
  return {
    status: "proposed",
    on_sale: false,
    features: [
      { key: "demo", label: "Museum demo", detail: "Public-domain museum pieces." },
      { key: "playground", label: "Photo playground", detail: "One photo, not kept." },
      { key: "archive", label: "Private archive", detail: "Only your account sees it." },
      { key: "boards", label: "Textile moodboards", detail: "With a colour story." },
    ],
    plans: [
      { id: "free", name: "Free", summary: "A small archive.", price_paise: 0, currency: "INR", period_days: null, max_pieces: 25, max_bytes: null, features: [...PUBLIC, "archive"] },
      { id: "studio", name: "Studio", summary: "A working archive.", price_paise: studioPrice, currency: "INR", period_days: 30, max_pieces: 100, max_bytes: 250 * MB, features: STUDIO },
      { id: "studio_pro", name: "Studio Pro", summary: "More room.", price_paise: 249_900, currency: "INR", period_days: 30, max_pieces: 250, max_bytes: 1024 * MB, features: STUDIO },
    ],
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("formatting", () => {
  it("shows whole paise as rupees, and storage as the API words it", () => {
    expect([formatPrice(0), formatPrice(99_900), formatPrice(249_900), formatPrice(249_950)]).toEqual(["₹0", "₹999", "₹2,499", "₹2,499.50"]);
    expect([formatStorage(250 * MB), formatStorage(1024 * MB), formatStorage(1536 * MB)]).toEqual(["250 MB", "1 GB", "1.5 GB"]);
    expect([formatPeriod(30), formatPeriod(null)]).toEqual(["per 30 days", "No payment"]);
  });
});

describe("Pricing", () => {
  it("shows each plan from the server's catalogue, marked as a proposal that can't be bought yet", async () => {
    const fetch = routeFetch({ "GET /api/billing/plans": () => Response.json(catalogue()) });
    renderWithQuery(<Pricing />);

    const studio = await screen.findByRole("region", { name: "Studio" });
    expect(studio).toHaveTextContent("₹999");
    expect(studio).toHaveTextContent("per 30 days");
    expect(studio).toHaveTextContent("Up to 100 pieces");
    expect(studio).toHaveTextContent("250 MB");
    expect(within(studio).getByRole("list", { name: "Studio includes" })).toHaveTextContent("Textile moodboards");
    expect(within(studio).getByRole("link", { name: "Ask about Studio" })).toHaveAttribute("href", "/pilot#request");
    expect(studio).toHaveTextContent("Payments aren't open yet.");

    const free = screen.getByRole("region", { name: "Free" });
    expect(free).toHaveTextContent("₹0");
    expect(free).toHaveTextContent("Up to 25 pieces");
    expect(free).toHaveTextContent("Not set yet"); // no storage figure is invented
    expect(within(free).getByRole("list", { name: "Free includes" })).not.toHaveTextContent("moodboards");
    expect(within(free).getByRole("link", { name: "Create a free account" })).toHaveAttribute("href", "/signup");
    expect(screen.getByRole("region", { name: "Studio Pro" })).toHaveTextContent("₹2,499");

    const note = screen.getByRole("note", { name: "About these prices" });
    expect(note).toHaveTextContent("Proposed pilot pricing");
    expect(note).toHaveTextContent("no payment can be made and no account is charged");
    // Only the catalogue is read; nothing is sent.
    expect(fetch.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${String(url)}`)).toEqual(["GET /api/billing/plans"]);
  });

  it("prints whatever price the server sets, never one of its own", async () => {
    routeFetch({ "GET /api/billing/plans": () => Response.json(catalogue({}, 120_000)) });
    renderWithQuery(<Pricing />);
    expect(await screen.findByRole("region", { name: "Studio" })).toHaveTextContent("₹1,200");
    expect(screen.queryByText("₹999")).not.toBeInTheDocument();
  });

  it("compares the plans in a table that says what each includes", async () => {
    routeFetch({ "GET /api/billing/plans": () => Response.json(catalogue()) });
    renderWithQuery(<Pricing />);
    const table = await screen.findByRole("table", { name: "What each plan includes and allows" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Feature", "Free", "Studio", "Studio Pro"]);
    const boards = within(table).getByRole("row", { name: /Textile moodboards/ });
    expect(within(boards).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Not included", "Included", "Included"]);
    const pieces = within(table).getByRole("row", { name: /Pieces in your archive/ });
    expect(within(pieces).getAllByRole("cell").map((c) => c.textContent)).toEqual(["25", "100", "250"]);
    // The table scrolls inside a region a keyboard can reach on a narrow screen.
    expect(screen.getByRole("region", { name: "Comparison table" })).toHaveAttribute("tabindex", "0");
  });

  it("says when the plans can't be loaded, and tries again on request", async () => {
    let calls = 0;
    routeFetch({
      "GET /api/billing/plans": () => (++calls === 1 ? apiErrorResponse(503, "unavailable", "Down") : Response.json(catalogue())),
    });
    renderWithQuery(<Pricing />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The plans couldn't be loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Studio" })).toBeInTheDocument();
    expect(calls).toBe(2);
  });
});
