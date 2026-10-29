import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { routeFetch } from "@/test/fetch-router";
import { makeItem, renderWithQuery } from "@/test/render";
import type { ItemList, LibrarySummary } from "@/types/api";
import { ColourLab } from "./colour-lab";

const summary: LibrarySummary = {
  total: 1,
  by_type: { fabric: 1 },
  by_status: {},
  color_families: [
    { family: "red", items: 4 },
    { family: "blue", items: 1 },
  ],
  tags: [],
  collections: 0,
  recent: [],
};

const piece = makeItem({
  palette: {
    colors: [
      { hex: "#d1291c", rgb: [209, 41, 28], name: "sindoor red", family: "red", percentage: 70 },
      { hex: "#263b5e", rgb: [38, 59, 94], name: "neel indigo", family: "blue", percentage: 30 },
    ],
    harmony: "complementary",
    source: "original",
    updated_at: "2026-10-29T10:00:00Z",
  },
});

const list = (items: ItemList["items"]): Response =>
  Response.json({ items, total: items.length, limit: 24, offset: 0, reasons: {} } satisfies ItemList);

describe("ColourLab", () => {
  it("shows the families as links into the colour filter, with real counts", async () => {
    routeFetch({ "GET /api/items/summary": () => Response.json(summary), "GET /api/items?": () => list([piece]) });
    renderWithQuery(<ColourLab />);

    const red = await screen.findByRole("link", { name: "red 4 pieces" });
    expect(red).toHaveAttribute("href", "/gallery?color=red");
    expect(screen.getByRole("link", { name: "blue 1 piece" })).toHaveAttribute("href", "/gallery?color=blue");
  });

  it("lists measured palettes with names, values and proportions", async () => {
    routeFetch({ "GET /api/items/summary": () => Response.json(summary), "GET /api/items?": () => list([piece]) });
    renderWithQuery(<ColourLab />);

    expect(await screen.findByRole("img", { name: "Palette: sindoor red 70%, neel indigo 30%" })).toBeInTheDocument();
    const row = screen.getByText("sindoor red").closest("li")!.parentElement!.closest("li")!;
    expect(within(row).getByText("#D1291C")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: /^Open$/ })).toHaveAttribute("href", `/items/${piece.id}`);
  });

  it("is honest about an archive with no measured colours", async () => {
    routeFetch({
      "GET /api/items/summary": () => Response.json({ ...summary, total: 0, color_families: [] }),
      "GET /api/items?": () => list([]),
    });
    renderWithQuery(<ColourLab />);

    expect(await screen.findByText("No colours measured yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a piece" })).toHaveAttribute("href", "/upload");
  });

  it("explains a failure and retries", async () => {
    let attempts = 0;
    routeFetch({
      "GET /api/items/summary": () =>
        attempts++ === 0 ? new Response("Internal Server Error", { status: 500 }) : Response.json(summary),
      "GET /api/items?": () => list([piece]),
    });
    renderWithQuery(<ColourLab />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Colours could not be loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "red 4 pieces" })).toBeInTheDocument();
  });
});
