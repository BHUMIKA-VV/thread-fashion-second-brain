import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiErrorResponse, routeFetch } from "@/test/fetch-router";
import { makeItem, renderWithQuery } from "@/test/render";
import type { OutfitColours, OutfitDetail, OutfitPieceRead } from "@/types/api";

import { ColourRelations } from "./colour-relations";
import { OutfitEditor } from "./outfit-editor";
import { OutfitList } from "./outfit-list";

vi.mock("next/navigation", async () => (await import("@/test/navigation-mock")).navigationMock);
const nav = await import("@/test/navigation-mock");

const A = makeItem({ id: "aaaaaaaa-0000-4000-8000-000000000001", notes: "Ajrakh stole" });
const B = makeItem({ id: "bbbbbbbb-0000-4000-8000-000000000002", notes: "Linen kurta" });
const C = makeItem({ id: "cccccccc-0000-4000-8000-000000000003", notes: "Silver jhumka", type: "accessory" });

const NO_COLOURS: OutfitColours = {
  dominant: [],
  shared: [],
  complementary: [],
  contrasting: [],
  pieces_with_palette: 0,
  pieces_without_palette: 0,
};

function outfit(pieces: OutfitPieceRead[] = [], overrides: Partial<OutfitDetail> = {}): OutfitDetail {
  return {
    id: "o1",
    name: "Sangeet evening",
    description: null,
    occasion: null,
    season: null,
    style_tags: [],
    notes: null,
    layout: "feature",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    pieces,
    colours: NO_COLOURS,
    collection_ids: [],
    ...overrides,
  };
}

const placed = (...items: (typeof A)[]): OutfitPieceRead[] =>
  items.map((item, position) => ({ item, role: "piece", position }));

function editorRoutes(start: OutfitDetail, extra: Parameters<typeof routeFetch>[0] = {}) {
  return routeFetch({
    "GET /api/outfits/o1": () => Response.json(start),
    "GET /api/items": () => Response.json({ items: [A, B, C], total: 3, limit: 24, offset: 0 }),
    "GET /api/collections": () => Response.json([]),
    "GET /api/tags/vocabulary": () => Response.json({ categories: [{ category: "occasion", tags: ["festive"] }] }),
    ...extra,
  });
}

beforeEach(() => nav.setUrl("/outfit-studio/o1"));

describe("OutfitList", () => {
  it("offers a clear first step when there are no outfits", async () => {
    routeFetch({ "GET /api/outfits": () => Response.json({ outfits: [], total: 0, limit: 24, offset: 0 }) });
    renderWithQuery(<OutfitList />);
    expect(await screen.findByText("No outfits yet")).toBeInTheDocument();
  });

  it("explains the account limit when creating fails", async () => {
    routeFetch({
      "GET /api/outfits": () => Response.json({ outfits: [], total: 0, limit: 24, offset: 0 }),
      "POST /api/outfits": () => apiErrorResponse(409, "outfit_limit", "An account can keep up to 200 outfits."),
    });
    renderWithQuery(<OutfitList />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "One more" } });
    fireEvent.click(screen.getByRole("button", { name: /Start an outfit/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("up to 200 outfits");
  });
});

describe("OutfitEditor", () => {
  it("adds a piece from the archive, using the accessory role for accessories", async () => {
    const fetchMock = editorRoutes(outfit(placed(A)), {
      "PUT /api/outfits/o1/items": ({ body }) => {
        expect(body).toEqual({
          items: [
            { item_id: A.id, role: "piece" },
            { item_id: C.id, role: "accessory" },
          ],
        });
        return Response.json(outfit([...placed(A), { item: C, role: "accessory", position: 1 }]));
      },
    });
    renderWithQuery(<OutfitEditor id="o1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Add Silver jhumka" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove Silver jhumka" })).toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true);
  });

  it("reorders with buttons, announces it, and keeps the end buttons focusable but inert", async () => {
    const puts: unknown[] = [];
    editorRoutes(outfit(placed(A, B)), {
      "PUT /api/outfits/o1/items": ({ body }) => {
        puts.push(body);
        return Response.json(outfit(placed(B, A)));
      },
    });
    renderWithQuery(<OutfitEditor id="o1" />);
    const earlier = await screen.findByRole("button", { name: "Move Ajrakh stole earlier" });
    expect(earlier).toHaveAttribute("aria-disabled", "true");
    expect(earlier).not.toBeDisabled();
    fireEvent.click(earlier);
    expect(puts).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Move Ajrakh stole later" }));
    expect(await screen.findByText("Ajrakh stole moved to position 2 of 2.")).toBeInTheDocument();
    await waitFor(() => expect(puts).toHaveLength(1));
    const order = within(screen.getByRole("list", { name: /Pieces in this outfit/ })).getAllByRole("listitem");
    expect(order[0]).toHaveTextContent("Linen kurta");
  });

  it("never loses a quick second change: both are sent, in order", async () => {
    const puts: { items: { item_id: string }[] }[] = [];
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    editorRoutes(outfit(placed(A)), {
      "PUT /api/outfits/o1/items": async ({ body }) => {
        puts.push(body as (typeof puts)[number]);
        if (puts.length === 1) await held;
        return Response.json(outfit(placed(...(puts.length === 1 ? [A, B] : [A, B, C]))));
      },
    });
    renderWithQuery(<OutfitEditor id="o1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Add Linen kurta" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Silver jhumka" }));
    expect(await screen.findByRole("button", { name: "Remove Silver jhumka" })).toBeInTheDocument();
    release();
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1].items.map((i) => i.item_id)).toEqual([A.id, B.id, C.id]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove Silver jhumka" })).toBeInTheDocument());
  });

  it("returns to the last confirmed state when the newest of several queued changes fails", async () => {
    const puts: unknown[] = [];
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    editorRoutes(outfit(placed(A)), {
      "PUT /api/outfits/o1/items": async ({ body }) => {
        puts.push(body);
        if (puts.length === 1) {
          await held;
          return Response.json(outfit(placed(A, B)));
        }
        return apiErrorResponse(422, "duplicate_piece", "A piece can only appear once.");
      },
      // What the server really holds after the first change succeeded.
      "GET /api/outfits/o1": () => Response.json(puts.length === 0 ? outfit(placed(A)) : outfit(placed(A, B))),
    });
    renderWithQuery(<OutfitEditor id="o1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Add Linen kurta" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Silver jhumka" }));
    release();
    expect(await screen.findByRole("alert")).toHaveTextContent("A piece can only appear once.");
    await waitFor(() => {
      const rows = within(screen.getByRole("list", { name: /Pieces in this outfit/ })).getAllByRole("listitem");
      expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining("Ajrakh"), expect.stringContaining("Linen")]);
    });
  });

  it("moves focus to a neighbour when a piece is removed, and to the heading when none is left", async () => {
    const answers = [outfit(placed(B)), outfit([])];
    editorRoutes(outfit(placed(A, B)), {
      "PUT /api/outfits/o1/items": () => Response.json(answers.shift()),
    });
    renderWithQuery(<OutfitEditor id="o1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Ajrakh stole" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove Linen kurta" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Remove Linen kurta" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Composition" })).toHaveFocus());
  });

  it("restores the previous order and says so when a change is refused", async () => {
    editorRoutes(outfit(placed(A, B)), {
      "PUT /api/outfits/o1/items": () => apiErrorResponse(422, "outfit_too_large", "An outfit can hold up to 12 pieces."),
    });
    renderWithQuery(<OutfitEditor id="o1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Move Ajrakh stole later" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("An outfit can hold up to 12 pieces.");
    expect(screen.getByRole("alert")).toHaveTextContent("back to its last saved state");
    const order = within(screen.getByRole("list", { name: /Pieces in this outfit/ })).getAllByRole("listitem");
    expect(order[0]).toHaveTextContent("Ajrakh stole");
  });

  it("replaces a piece in place, keeping its position", async () => {
    let sent: unknown;
    editorRoutes(outfit(placed(A, B)), {
      "PUT /api/outfits/o1/items": ({ body }) => {
        sent = body;
        return Response.json(outfit(placed(C, B)));
      },
    });
    renderWithQuery(<OutfitEditor id="o1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Replace Ajrakh stole" }));
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("takes the place of Ajrakh stole");
    fireEvent.click(await screen.findByRole("button", { name: "Use Silver jhumka" }));
    await waitFor(() =>
      expect(sent).toEqual({
        items: [
          { item_id: C.id, role: "piece" },
          { item_id: B.id, role: "piece" },
        ],
      }),
    );
  });

  it("stops offering more pieces at twelve", async () => {
    const twelve = Array.from({ length: 12 }, (_, i) =>
      makeItem({ id: `dddddddd-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`, notes: `Piece ${i}` }),
    );
    editorRoutes(outfit(placed(...twelve)));
    renderWithQuery(<OutfitEditor id="o1" />);
    const add = await screen.findByRole("button", { name: "Add Silver jhumka" });
    expect(add).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(add);
    expect(screen.queryByRole("button", { name: "Remove Silver jhumka" })).not.toBeInTheDocument();
  });

  it("shows an outfit whose pieces were all deleted as an empty composition", async () => {
    editorRoutes(outfit([]));
    renderWithQuery(<OutfitEditor id="o1" />);
    expect(await screen.findByText("Nothing composed yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export PNG/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("gives the same answer for a missing outfit and someone else's", async () => {
    routeFetch({ "GET /api/outfits/o1": () => apiErrorResponse(404, "not_found", "Not found") });
    renderWithQuery(<OutfitEditor id="o1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("This outfit doesn't exist");
  });

  it("saves details with cleared fields as null, and changing layout keeps unsaved typing", async () => {
    const patches: unknown[] = [];
    editorRoutes(outfit(placed(A), { occasion: "festive" }), {
      "PATCH /api/outfits/o1": ({ body }) => {
        patches.push(body);
        return Response.json(outfit(placed(A), { layout: "grid" }));
      },
    });
    renderWithQuery(<OutfitEditor id="o1" />);
    fireEvent.change(await screen.findByLabelText("Occasion"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("radio", { name: "Grid" }));
    await waitFor(() => expect(patches).toEqual([{ layout: "grid" }]));
    const save = screen.getByRole("button", { name: /Save details/ });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(patches[1]).toMatchObject({ occasion: null, name: "Sangeet evening" }));
  });
});

describe("ColourRelations", () => {
  const red = { hex: "#C81E28", name: "red", share: 40, item_ids: ["a", "b"] };
  const teal = { hex: "#1EC8BE", name: "teal", share: 30, item_ids: ["b"] };

  it("reports relationships and explains how they are worked out", () => {
    renderWithQuery(
      <ColourRelations
        colours={{
          dominant: [red, teal],
          shared: [red],
          complementary: [[red, teal]],
          contrasting: [],
          pieces_with_palette: 2,
          pieces_without_palette: 1,
        }}
      />,
    );
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText("in 2 pieces")).toBeInTheDocument();
    expect(screen.getByText("No strong light and dark contrast across pieces.")).toBeInTheDocument();
    expect(screen.getByText("1 piece has no measured palette and is left out.")).toBeInTheDocument();
    expect(screen.getByText(/visual relationships, not rules/)).toBeInTheDocument();
  });

  it("invents nothing when no piece has a palette", () => {
    renderWithQuery(<ColourRelations colours={NO_COLOURS} />);
    expect(screen.getByText(/Add a piece with a measured palette/)).toBeInTheDocument();
    expect(screen.queryByText("Dominant")).not.toBeInTheDocument();
  });
});
