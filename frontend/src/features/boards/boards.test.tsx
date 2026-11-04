import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiErrorResponse, routeFetch } from "@/test/fetch-router";
import { makeItem, renderWithQuery } from "@/test/render";
import type { BoardBlock, BoardDetail, BoardSummary, ChosenColour, CollectionSummary, ColourStory, ItemList } from "@/types/api";
import { BoardEditor, MAX_BLOCKS, blockLabel } from "./board-editor";
import { BoardsList } from "./boards-list";
import { ColourStoryView, matchText } from "./colour-story";

vi.mock("next/navigation", async () => (await import("@/test/navigation-mock")).navigationMock);
const nav = await import("@/test/navigation-mock");

const LINEN = makeItem({
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  notes: "Linen dupatta",
  palette: {
    colors: [
      { hex: "#d1291c", rgb: [209, 41, 28], name: "sindoor red", family: "red", percentage: 70 },
      { hex: "#263b5e", rgb: [38, 59, 94], name: "neel indigo", family: "blue", percentage: 30 },
    ],
    harmony: "complementary",
    source: "original",
    updated_at: "2026-11-04T10:00:00Z",
  },
});

const NOW = "2026-11-04T10:00:00Z";

function block(overrides: Partial<BoardBlock> & Pick<BoardBlock, "id" | "kind" | "position">): BoardBlock {
  return { item: null, colour: null, body: null, created_at: NOW, ...overrides };
}

const BLOCKS: BoardBlock[] = [
  block({ id: "b1", kind: "heading", position: 0, body: "Colour story" }),
  block({ id: "b2", kind: "piece", position: 1, item: LINEN, body: "For the lining" }),
  block({ id: "b3", kind: "colour", position: 2, colour: { hex: "#263b5e", name: "neel indigo", family: "blue" } }),
  block({ id: "b4", kind: "note", position: 3, body: "Keep the gold to the borders." }),
];

const EMPTY_STORY: ColourStory = {
  measured: { dominant: [], shared: [], complementary: [], contrasting: [], pieces_with_palette: 0, pieces_without_palette: 0 },
  chosen: [],
  harmony: null,
};

const STORY: ColourStory = {
  measured: {
    dominant: [
      { hex: "#d1291c", name: "sindoor red", share: 70, item_ids: [LINEN.id] },
      { hex: "#263b5e", name: "neel indigo", share: 30, item_ids: [LINEN.id] },
    ],
    shared: [],
    complementary: [],
    contrasting: [],
    pieces_with_palette: 1,
    pieces_without_palette: 0,
  },
  chosen: [
    {
      block_id: "b3",
      hex: "#263b5e",
      name: "neel indigo",
      family: "blue",
      nearest: { hex: "#263b5e", name: "neel indigo", item_id: LINEN.id, distance: 0 },
      on_pieces: true,
    },
  ],
  harmony: "complementary",
};

function board(blocks = BLOCKS, overrides: Partial<BoardDetail> = {}): BoardDetail {
  return {
    id: "bd1",
    name: "Meera, sangeet",
    description: "Indigo and gold",
    created_at: NOW,
    updated_at: NOW,
    blocks,
    colour_story: blocks.length ? STORY : EMPTY_STORY,
    ...overrides,
  };
}

const emptyArchive = (): Response =>
  Response.json({ items: [LINEN], total: 1, limit: 24, offset: 0, reasons: {} } satisfies ItemList);

function bodies(fetchMock: ReturnType<typeof routeFetch>, method: string): unknown[] {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === method)
    .map(([input, init]) => ({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null }));
}

beforeEach(() => nav.setUrl("/boards"));

describe("blockLabel", () => {
  it("names each kind of block by what it shows", () => {
    expect(BLOCKS.map(blockLabel)).toEqual([
      "Heading: Colour story",
      "Linen dupatta",
      "neel indigo #263B5E",
      "Note: Keep the gold to the borders.",
    ]);
    expect(blockLabel(block({ id: "x", kind: "note", position: 0, body: "x".repeat(50) }))).toBe(`Note: ${"x".repeat(40)}…`);
  });
});

describe("BoardsList", () => {
  const summary: BoardSummary = {
    id: "bd1",
    name: "Meera, sangeet",
    description: "Indigo and gold",
    block_count: 4,
    cover_thumbnails: [LINEN.thumbnail_url],
    created_at: NOW,
    updated_at: NOW,
  };
  const collection: CollectionSummary = {
    id: "c1",
    name: "Shortlist",
    description: null,
    item_count: 3,
    is_public: false,
    cover_thumbnails: [],
    contains_item: null,
    created_at: NOW,
    updated_at: NOW,
  };

  it("lists boards with covers and counts", async () => {
    routeFetch({ "GET /api/boards": () => Response.json([summary]), "GET /api/collections": () => Response.json([]) });
    renderWithQuery(<BoardsList />);
    const card = await screen.findByRole("link", { name: /Meera, sangeet/ });
    expect(card).toHaveAttribute("href", "/boards/bd1");
    expect(within(card).getByText("4 blocks")).toBeInTheDocument();
  });

  it("creates a board from a collection and opens it", async () => {
    const fetchMock = routeFetch({
      "GET /api/boards": () => Response.json([]),
      "GET /api/collections": () => Response.json([collection]),
      "POST /api/boards": () => Response.json(board(), { status: 201 }),
    });
    renderWithQuery(<BoardsList fromCollection="c1" />);
    await screen.findByRole("option", { name: "Collection: Shortlist (3)" });
    expect(screen.getByLabelText("Start from")).toHaveValue("c1");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " Meera, sangeet " } });
    fireEvent.click(screen.getByRole("button", { name: "Create board" }));
    await waitFor(() => expect(nav.router.push).toHaveBeenCalledWith("/boards/bd1"));
    expect(bodies(fetchMock, "POST")).toEqual([
      { url: "/api/boards", body: { name: "Meera, sangeet", description: null, from_collection_id: "c1" } },
    ]);
  });

  it("explains a refusal", async () => {
    routeFetch({
      "GET /api/boards": () => Response.json([]),
      "GET /api/collections": () => Response.json([]),
      "POST /api/boards": () => apiErrorResponse(409, "board_limit", "Your archive has reached its limit of 200 boards."),
    });
    renderWithQuery(<BoardsList />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "One more" } });
    fireEvent.click(screen.getByRole("button", { name: "Create board" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("limit of 200 boards");
  });
});

describe("BoardEditor", () => {
  it("shows each block in order with what Thread measured", async () => {
    routeFetch({ "GET /api/boards/bd1": () => Response.json(board()), "GET /api/items?": emptyArchive });
    renderWithQuery(<BoardEditor id="bd1" />);
    const list = await screen.findByRole("list", { name: "Blocks on this board" });
    const articles = within(list).getAllByRole("article");
    expect(articles.map((a) => a.getAttribute("aria-label"))).toEqual(BLOCKS.map(blockLabel));
    expect(within(articles[1]).getByRole("img", { name: "Palette: sindoor red, neel indigo" })).toBeInTheDocument();
    expect(within(articles[2]).getByText("#263B5E")).toBeInTheDocument();
    expect(within(articles[1]).getByLabelText("Caption")).toHaveValue("For the lining");
    // The first block can't move earlier, nor the last later.
    expect(screen.getByRole("button", { name: "Move Heading: Colour story earlier" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Note: Keep the gold to the borders. later" })).toBeDisabled();
    // A piece already on the board is marked in the picker.
    expect(await screen.findByRole("button", { name: "Linen dupatta, on this board" })).toHaveAttribute("aria-disabled", "true");
  });

  it("adds notes, headings and colours, measured or chosen", async () => {
    const fetchMock = routeFetch({
      "GET /api/boards/bd1": () => Response.json(board()),
      "POST /api/boards/bd1/blocks": () => Response.json(board()),
      "GET /api/items?": emptyArchive,
    });
    renderWithQuery(<BoardEditor id="bd1" />);
    await screen.findByRole("list", { name: "Blocks on this board" });

    fireEvent.change(screen.getByLabelText("Note text"), { target: { value: "  Hand-finished hems " } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    fireEvent.click(screen.getByRole("radio", { name: "Heading" }));
    fireEvent.change(screen.getByLabelText("Heading text"), { target: { value: "Fabrics" } });
    fireEvent.click(screen.getByRole("button", { name: "Add heading" }));
    // neel indigo is already a colour block; sindoor red, measured on the linen, is not.
    expect(screen.getByRole("button", { name: "neel indigo #263B5E, on this board" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "Add sindoor red #D1291C" }));
    fireEvent.change(screen.getByLabelText("Hex"), { target: { value: "#C8A2C8" } });
    fireEvent.click(screen.getByRole("button", { name: "Add colour" }));

    await waitFor(() => expect(bodies(fetchMock, "POST")).toHaveLength(4));
    expect(bodies(fetchMock, "POST").map((c) => (c as { body: unknown }).body)).toEqual([
      { kind: "note", body: "Hand-finished hems" },
      { kind: "heading", body: "Fabrics" },
      { kind: "colour", hex: "#d1291c", body: null },
      { kind: "colour", hex: "#c8a2c8", body: null },
    ]);
  });

  it("refuses a malformed hex before sending it", async () => {
    routeFetch({ "GET /api/boards/bd1": () => Response.json(board([])), "GET /api/items?": emptyArchive });
    renderWithQuery(<BoardEditor id="bd1" />);
    const hex = await screen.findByLabelText("Hex");
    fireEvent.change(hex, { target: { value: "#12345" } });
    expect(hex).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Add colour" })).toBeDisabled();
    expect(screen.getByText(/This board is empty/)).toBeInTheDocument();
  });

  it("moves, captions and removes blocks, and keeps a note's text", async () => {
    const fetchMock = routeFetch({
      "GET /api/boards/bd1": () => Response.json(board()),
      "PATCH /api/boards/bd1/blocks/": () => Response.json(board()),
      "DELETE /api/boards/bd1/blocks/": () => Response.json(board()),
      "GET /api/items?": emptyArchive,
    });
    renderWithQuery(<BoardEditor id="bd1" />);
    await screen.findByRole("list", { name: "Blocks on this board" });

    fireEvent.click(screen.getByRole("button", { name: "Move Linen dupatta later" }));
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toHaveLength(1));
    const caption = screen.getByRole("article", { name: "Linen dupatta" }).querySelector("textarea")!;
    fireEvent.change(caption, { target: { value: "  " } });
    fireEvent.blur(caption);
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toHaveLength(2));

    // Emptying a note doesn't send anything: its text comes back; removing is a separate act.
    const note = within(screen.getByRole("article", { name: "Note: Keep the gold to the borders." })).getByLabelText("Note");
    fireEvent.change(note, { target: { value: "" } });
    fireEvent.blur(note);
    expect(note).toHaveValue("Keep the gold to the borders.");

    fireEvent.click(screen.getByRole("button", { name: "Remove neel indigo #263B5E from this board" }));
    await waitFor(() => expect(bodies(fetchMock, "DELETE")).toHaveLength(1));
    expect(bodies(fetchMock, "PATCH")).toEqual([
      { url: "/api/boards/bd1/blocks/b2", body: { position: 2 } },
      { url: "/api/boards/bd1/blocks/b2", body: { body: null } },
    ]);
    expect(bodies(fetchMock, "DELETE")).toEqual([{ url: "/api/boards/bd1/blocks/b3", body: null }]);
  });

  // Renders all 120 blocks, so it gets more time than the default when the suite runs in parallel.
  it("stops offering to add once the board is full", { timeout: 20_000 }, async () => {
    const full = Array.from({ length: MAX_BLOCKS }, (_, i) => block({ id: `n${i}`, kind: "note", position: i, body: `Note ${i}` }));
    routeFetch({ "GET /api/boards/bd1": () => Response.json(board(full)) });
    renderWithQuery(<BoardEditor id="bd1" />);
    expect(await screen.findByText(/This board is full \(120 blocks\)/, {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add note" })).not.toBeInTheDocument();
  });

  it("explains a refusal to add", async () => {
    routeFetch({
      "GET /api/boards/bd1": () => Response.json(board([])),
      "POST /api/boards/bd1/blocks": () => apiErrorResponse(409, "board_full", "A board can hold up to 120 blocks."),
      "GET /api/items?": emptyArchive,
    });
    renderWithQuery(<BoardEditor id="bd1" />);
    fireEvent.change(await screen.findByLabelText("Note text"), { target: { value: "One more" } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(await screen.findByText("A board can hold up to 120 blocks.")).toBeInTheDocument();
  });

  it("says so when the board doesn't exist", async () => {
    routeFetch({ "GET /api/boards/nope": () => apiErrorResponse(404, "not_found", "Board not found.") });
    renderWithQuery(<BoardEditor id="nope" />);
    expect(await screen.findByText("This board doesn't exist")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All boards" })).toHaveAttribute("href", "/boards");
  });
});

describe("the colour story", () => {
  const chosen = (overrides: Partial<ChosenColour>): ChosenColour => ({ ...STORY.chosen[0], ...overrides });
  const name = (id: string) => (id === LINEN.id ? "Linen dupatta" : "a piece");

  it("says in words how a chosen colour relates to what was measured", () => {
    expect(matchText(STORY.chosen[0], name)).toBe("Matches neel indigo on Linen dupatta (difference 0.0).");
    const far = chosen({ hex: "#1f7a3a", name: "green", on_pieces: false, nearest: { hex: "#263b5e", name: "neel indigo", item_id: LINEN.id, distance: 31.24 } });
    expect(matchText(far, name)).toBe("Not on the pieces yet; nearest is neel indigo on Linen dupatta (difference 31.2).");
    expect(matchText(chosen({ nearest: null, on_pieces: false }), name)).toBe("No measured pieces on this board to compare with.");
  });

  it("shows the harmony, the measured relationships and each chosen colour", () => {
    renderWithQuery(<ColourStoryView board={board()} />);
    const section = screen.getByRole("region", { name: "Colour story" });
    expect(section).toHaveTextContent("Harmony: Complementary — opposite hues");
    expect(within(section).getByRole("heading", { name: "Colour relationships" })).toBeInTheDocument();
    const list = within(section).getByRole("list", { name: "Chosen colours and their nearest measured colour" });
    expect(list).toHaveTextContent("neel indigo #263B5E");
    expect(list).toHaveTextContent("Matches neel indigo on Linen dupatta (difference 0.0).");
  });

  it("invites colours on an empty board instead of inventing a story", () => {
    renderWithQuery(<ColourStoryView board={board([])} />);
    const section = screen.getByRole("region", { name: "Colour story" });
    expect(section).toHaveTextContent("Add pieces or colours and the board's colour story appears here.");
    expect(section).not.toHaveTextContent("Harmony:");
    expect(section).toHaveTextContent("No colours chosen yet.");
  });

  it("is part of the board editor", async () => {
    routeFetch({ "GET /api/boards/bd1": () => Response.json(board()), "GET /api/items?": emptyArchive });
    renderWithQuery(<BoardEditor id="bd1" />);
    expect(await screen.findByRole("region", { name: "Colour story" })).toHaveTextContent("Matches neel indigo on Linen dupatta");
  });
});
