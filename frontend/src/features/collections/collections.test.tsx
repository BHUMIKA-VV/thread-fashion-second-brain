import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Dashboard } from "@/features/dashboard/dashboard";
import { apiErrorResponse, routeFetch } from "@/test/fetch-router";
import { makeItem, renderWithQuery } from "@/test/render";
import type { CollectionDetail, CollectionSummary, LibrarySummary } from "@/types/api";
import { AddToCollection } from "./add-to-collection";
import { CollectionDetailView } from "./collection-detail";
import { CollectionsList } from "./collections-list";

vi.mock("next/navigation", async () => (await import("@/test/navigation-mock")).navigationMock);
const nav = await import("@/test/navigation-mock");

const ITEM_A = makeItem({ id: "aaaaaaaa-0000-4000-8000-000000000001", notes: "Ajrakh stole" });
const ITEM_B = makeItem({ id: "bbbbbbbb-0000-4000-8000-000000000002", notes: "Linen kurta" });

function summary(overrides: Partial<CollectionSummary> = {}): CollectionSummary {
  return {
    id: "c1",
    name: "Summer linen",
    description: "Breathable whites",
    item_count: 2,
    cover_thumbnails: [ITEM_A.thumbnail_url, ITEM_B.thumbnail_url],
    contains_item: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

function detail(items = [ITEM_A, ITEM_B], overrides: Partial<CollectionDetail> = {}): CollectionDetail {
  return {
    id: "c1",
    name: "Summer linen",
    description: "Breathable whites",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    items: items.map((item, position) => ({ item, note: position === 0 ? "for the sangeet" : null, position, added_at: "2026-10-01T00:00:00Z" })),
    ...overrides,
  };
}

function patchBodies(fetchMock: ReturnType<typeof routeFetch>, method = "PATCH"): unknown[] {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === method).map(([, init]) => JSON.parse(String(init!.body)));
}

beforeEach(() => nav.setUrl("/collections"));

describe("CollectionsList", () => {
  it("lists collections with cover mosaics and counts", async () => {
    routeFetch({ "GET /api/collections": () => Response.json([summary()]) });
    renderWithQuery(<CollectionsList />);

    const card = await screen.findByRole("link", { name: /Summer linen/ });
    expect(card).toHaveAttribute("href", "/collections/c1");
    expect(within(card).getByText("2 pieces")).toBeInTheDocument();
    expect(within(card).getAllByRole("presentation")).toHaveLength(2); // cover thumbnails (alt="")
  });

  it("creates a collection and reports duplicate names", async () => {
    let attempts = 0;
    const fetchMock = routeFetch({
      "GET /api/collections": () => Response.json([]),
      "POST /api/collections": () =>
        attempts++ === 0
          ? apiErrorResponse(409, "conflict", "You already have a collection with this name.")
          : Response.json(detail([])),
    });
    renderWithQuery(<CollectionsList />);
    expect(await screen.findByText(/No collections yet/)).toBeInTheDocument();
    const form = screen.getByRole("form", { name: "New collection" });

    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Summer linen" } });
    fireEvent.click(within(form).getByRole("button", { name: /Create collection/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already have a collection with this name");

    fireEvent.click(within(form).getByRole("button", { name: /Create collection/ }));
    await waitFor(() => expect(within(form).getByLabelText("Name")).toHaveValue(""));
    expect(patchBodies(fetchMock, "POST")).toEqual([
      { name: "Summer linen", description: null },
      { name: "Summer linen", description: null },
    ]);
  });
});

describe("CollectionDetailView", () => {
  it("moves items with accessible earlier/later buttons, disabled at the ends", async () => {
    const fetchMock = routeFetch({
      "GET /api/collections/c1": () => Response.json(detail()),
      "PATCH /api/collections/c1/items/": () => Response.json(detail([ITEM_B, ITEM_A])),
    });
    renderWithQuery(<CollectionDetailView id="c1" />);

    const first = await screen.findByRole("article", { name: "Ajrakh stole" });
    expect(within(first).getByRole("button", { name: "Move Ajrakh stole earlier" })).toBeDisabled();
    const second = screen.getByRole("article", { name: "Linen kurta" });
    expect(within(second).getByRole("button", { name: "Move Linen kurta later" })).toBeDisabled();

    fireEvent.click(within(first).getByRole("button", { name: "Move Ajrakh stole later" }));

    await waitFor(() => expect(patchBodies(fetchMock)).toEqual([{ position: 1 }]));
    const order = await screen.findAllByRole("article");
    await waitFor(() => expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["Linen kurta", "Ajrakh stole"]));
    expect(order.length).toBe(2);
  });

  it("saves a per-collection note on blur and removes items", async () => {
    const fetchMock = routeFetch({
      "GET /api/collections/c1": () => Response.json(detail()),
      "PATCH /api/collections/c1/items/": () => Response.json(detail()),
      "DELETE /api/collections/c1/items/": () => Response.json(detail([ITEM_A])),
    });
    renderWithQuery(<CollectionDetailView id="c1" />);
    const second = await screen.findByRole("article", { name: "Linen kurta" });

    const note = within(second).getByLabelText("Note in this collection");
    fireEvent.change(note, { target: { value: " pair with zari dupatta " } });
    fireEvent.blur(note);
    await waitFor(() => expect(patchBodies(fetchMock)).toEqual([{ note: "pair with zari dupatta" }]));

    fireEvent.click(within(second).getByRole("button", { name: "Remove Linen kurta from this collection" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Linen kurta" })).not.toBeInTheDocument());
  });

  it("asks before deleting and explains the pieces are kept", async () => {
    const fetchMock = routeFetch({
      "GET /api/collections/c1": () => Response.json(detail()),
      "DELETE /api/collections/c1": () => new Response(null, { status: 204 }),
    });
    renderWithQuery(<CollectionDetailView id="c1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete collection" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("The 2 pieces stay in your library");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete collection" }));
    await waitFor(() => expect(nav.router.push).toHaveBeenCalledWith("/collections"));
  });

  it("renames the collection", async () => {
    const fetchMock = routeFetch({
      "GET /api/collections/c1": () => Response.json(detail()),
      "PATCH /api/collections/c1": () => Response.json(detail(undefined, { name: "Summer linens" })),
    });
    renderWithQuery(<CollectionDetailView id="c1" />);
    const form = await screen.findByRole("form", { name: "Collection details" });

    fireEvent.change(within(form).getByLabelText("Collection name"), { target: { value: "Summer linens" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save details" }));

    await waitFor(() => expect(patchBodies(fetchMock)).toEqual([{ name: "Summer linens", description: "Breathable whites" }]));
  });
});

describe("AddToCollection", () => {
  it("ticks collections that contain the item and toggles membership", async () => {
    let inFestive = false;
    const fetchMock = routeFetch({
      [`GET /api/collections?item_id=${ITEM_A.id}`]: () =>
        Response.json([summary({ contains_item: true }), summary({ id: "c2", name: "Festive", contains_item: inFestive })]),
      "POST /api/collections/c2/items": () => {
        inFestive = true;
        return Response.json(detail());
      },
    });
    renderWithQuery(<AddToCollection itemId={ITEM_A.id} />);

    fireEvent.click(screen.getByRole("button", { name: /Add to collection/ }));
    expect(await screen.findByRole("checkbox", { name: /Summer linen/ })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: /Festive/ }));
    expect(await screen.findByRole("checkbox", { name: /Festive/ })).toBeChecked(); // optimistic

    await waitFor(() => expect(patchBodies(fetchMock, "POST")).toEqual([{ item_id: ITEM_A.id, note: null }]));
  });

  it("rolls the tick back when the server refuses", async () => {
    let listed = 0;
    routeFetch({
      [`GET /api/collections?item_id=${ITEM_A.id}`]: () => {
        listed++;
        return Response.json([summary({ id: "c2", name: "Festive", contains_item: false })]);
      },
      "POST /api/collections/c2/items": () => apiErrorResponse(404, "not_found", "Collection not found."),
    });
    renderWithQuery(<AddToCollection itemId={ITEM_A.id} />);

    fireEvent.click(screen.getByRole("button", { name: /Add to collection/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Festive/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Collection not found.");
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /Festive/ })).not.toBeChecked());
    expect(listed).toBeGreaterThanOrEqual(1);
  });
});

describe("Dashboard", () => {
  const data: LibrarySummary = {
    total: 3,
    by_type: { fabric: 2, garment: 1 },
    by_status: { completed: 3 },
    color_families: [{ family: "red", items: 2 }],
    tags: [{ category: "craft", tag: "ikat", items: 2 }],
    collections: 1,
    recent: [ITEM_A],
  };

  it("shows real counts that link into filtered gallery views", async () => {
    routeFetch({ "GET /api/items/summary": () => Response.json(data) });
    renderWithQuery(<Dashboard />);

    expect(await screen.findByRole("link", { name: /Pieces\s*3/ })).toHaveAttribute("href", "/gallery");
    expect(screen.getByRole("link", { name: /Fabric swatches\s*2/ })).toHaveAttribute("href", "/gallery?type=fabric");
    expect(screen.getByRole("link", { name: /red/ })).toHaveAttribute("href", "/gallery?color=red");
    expect(screen.getByRole("link", { name: /ikat/ })).toHaveAttribute("href", "/gallery?tag=craft%3Aikat");
  });

  it("has an empty state for a new library", async () => {
    routeFetch({ "GET /api/items/summary": () => Response.json({ ...data, total: 0, by_type: {}, recent: [] }) });
    renderWithQuery(<Dashboard />);
    expect(await screen.findByText("Your library is empty")).toBeInTheDocument();
  });
});

describe("Dashboard errors", () => {
  it("says why it could not load and recovers on retry", async () => {
    let attempts = 0;
    routeFetch({
      "GET /api/items/summary": () =>
        attempts++ === 0 // the test client does not retry, so only the first request fails
          ? new Response("Internal Server Error", { status: 500 })
          : Response.json({ total: 0, by_type: {}, by_status: {}, color_families: [], tags: [], collections: 0, recent: [] }),
    });
    renderWithQuery(<Dashboard />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The dashboard could not be loaded.");
    expect(alert).toHaveTextContent("The Thread API is not reachable.");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Your library is empty")).toBeInTheDocument();
  });
});
