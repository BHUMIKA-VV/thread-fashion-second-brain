import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { routeFetch } from "@/test/fetch-router";
import { makeItem, renderWithQuery } from "@/test/render";
import type { ItemList, LibrarySummary, Vocabulary } from "@/types/api";
import { Gallery } from "./gallery";

vi.mock("next/navigation", async () => (await import("@/test/navigation-mock")).navigationMock);
const nav = await import("@/test/navigation-mock");

function list(items: ItemList["items"], extra: Partial<ItemList> = {}): Response {
  return Response.json({ items, total: items.length, limit: 24, offset: 0, reasons: {}, ...extra } satisfies ItemList);
}

const summary: LibrarySummary = {
  total: 1,
  by_type: { fabric: 1 },
  by_status: {},
  color_families: [{ family: "red", items: 1 }],
  tags: [{ category: "craft", tag: "ikat", items: 1 }],
  collections: 0,
  recent: [],
};
const vocabulary: Vocabulary = { version: "v", categories: [] };

function routes(items: (url: string) => Response) {
  return routeFetch({
    "GET /api/items/summary": () => Response.json(summary),
    "GET /api/tags/vocabulary": () => Response.json(vocabulary),
    "GET /api/items?": ({ url }) => items(url),
  });
}

function itemCalls(fetchMock: ReturnType<typeof routes>): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith("/api/items?"));
}

beforeEach(() => nav.setUrl("/gallery"));

describe("Gallery", () => {
  it("shows an empty state that links to upload", async () => {
    routes(() => list([]));
    renderWithQuery(<Gallery />);

    expect(await screen.findByText("Your library is empty")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upload images" })).toHaveAttribute("href", "/upload");
  });

  it("renders thumbnails through the API proxy with honest status", async () => {
    const item = makeItem();
    routes(() => list([item]));
    renderWithQuery(<Gallery />);

    const link = await screen.findByRole("link", { name: /garment image/i });
    expect(link).toHaveAttribute("href", `/items/${item.id}`);
    expect(within(link).getByRole("img")).toHaveAttribute("src", `/api/items/${item.id}/image?variant=thumbnail`);
    expect(screen.getByText("Awaiting analysis")).toBeInTheDocument();
    expect(screen.getByText("1 piece")).toBeInTheDocument();
  });

  it("adds a palette strip when the item has a palette", async () => {
    const item = makeItem({
      palette: {
        colors: [{ hex: "#d1291c", rgb: [209, 41, 28], name: "sindoor red", family: "red", percentage: 100 }],
        harmony: "monochromatic",
        source: "masked",
        updated_at: "2026-10-24T10:00:00Z",
      },
    });
    routes(() => list([item]));
    renderWithQuery(<Gallery />);

    expect(await screen.findByRole("img", { name: "Palette: sindoor red" })).toBeInTheDocument();
  });

  it("reads filters from the URL and sends them to the API", async () => {
    nav.setUrl("/gallery?q=ikat&tag=craft%3Aikat&color=red&type=fabric&sort=relevance");
    const fetchMock = routes(() => list([]));
    renderWithQuery(<Gallery />);

    expect(await screen.findByText("No pieces match these filters")).toBeInTheDocument();
    expect(itemCalls(fetchMock).at(-1)).toBe(
      "/api/items?q=ikat&tag=craft%3Aikat&color=red&type=fabric&sort=relevance&limit=24&offset=0",
    );
    const active = screen.getByLabelText("Active filters");
    expect(within(active).getByText("“ikat”")).toBeInTheDocument();
    expect(within(active).getByText("Tag: ikat (craft)")).toBeInTheDocument();
    expect(within(active).getByText("Colour: red")).toBeInTheDocument();
  });

  it("type chips and colour swatches update the URL", async () => {
    routes(() => list([]));
    renderWithQuery(<Gallery />);
    await screen.findByText("Your library is empty");

    fireEvent.click(screen.getByRole("button", { name: "Fabrics" }));
    expect(nav.currentSearch()).toBe("type=fabric");
    await waitFor(() => expect(screen.getByRole("button", { name: "Fabrics" })).toHaveAttribute("aria-pressed", "true"));

    fireEvent.click(screen.getByRole("button", { name: "red (1)" }));
    expect(nav.currentSearch()).toBe("color=red&type=fabric");
    expect(await screen.findByText("No pieces match these filters")).toBeInTheDocument();
  });

  it("debounces the search box into the URL", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    routes(() => list([]));
    renderWithQuery(<Gallery />);
    await screen.findByText("Your library is empty");

    fireEvent.change(screen.getByRole("searchbox", { name: "Search your library" }), { target: { value: "haldi" } });
    expect(nav.currentSearch()).toBe("");
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(nav.currentSearch()).toBe("q=haldi");
    vi.useRealTimers();
  });

  it("adds tag filters and clears everything", async () => {
    routes(() => list([]));
    renderWithQuery(<Gallery />);
    await screen.findByText("Your library is empty");

    fireEvent.change(screen.getByPlaceholderText(/Filter by tag/), { target: { value: "Craft:Ikat" } });
    fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
    expect(nav.currentSearch()).toBe("tag=craft%3Aikat");

    fireEvent.click(await screen.findByRole("button", { name: "Clear all filters" }));
    expect(nav.currentSearch()).toBe("");
  });

  it("shows why each item matched a search", async () => {
    nav.setUrl("/gallery?q=ikat");
    const item = makeItem();
    routes(() => list([item], { reasons: { [item.id]: ["Tag: craft · ikat", "Notes mention it"] } }));
    renderWithQuery(<Gallery />);

    expect(await screen.findByLabelText("Why this matched")).toHaveTextContent("Tag: craft · ikat · Notes mention it");
    expect(screen.getByText("1 piece match")).toBeInTheDocument();
  });

  it("shows an error with a working retry", async () => {
    let attempts = 0;
    const fetchMock = routes(() =>
      attempts++ === 0 ? new Response("Internal Server Error", { status: 500 }) : list([]),
    );
    renderWithQuery(<Gallery />);

    expect(await screen.findByRole("alert")).toHaveTextContent("The gallery could not be loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Your library is empty")).toBeInTheDocument();
    expect(itemCalls(fetchMock)).toHaveLength(2);
  });
});
