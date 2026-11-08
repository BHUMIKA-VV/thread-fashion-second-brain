import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { routeFetch } from "@/test/fetch-router";
import { makeItem, renderWithQuery } from "@/test/render";
import type { BoardBlock, BoardDetail, CollectionDetail } from "@/types/api";

import { Presenter, slideFromHash } from "./presenter";
import { BoardPresentation, CollectionPresentation } from "./presentations";
import { boardSlides, collectionSlides, slideTitle } from "./slides";

vi.mock("next/navigation", async () => (await import("@/test/navigation-mock")).navigationMock);
const nav = await import("@/test/navigation-mock");

const NOW = "2026-11-04T10:00:00Z";
const SILK = makeItem({
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  type: "fabric",
  suggested_type: "garment",
  processing_status: "completed",
  notes: "Silk dress, French, 1883–85. Museum record C.I.53.63a, b.",
  source_url: "https://www.metmuseum.org/art/collection/search/105336",
  palette: {
    colors: [{ hex: "#d1291c", rgb: [209, 41, 28], name: "sindoor red", family: "red", percentage: 100 }],
    harmony: "monochromatic",
    source: "original",
    updated_at: NOW,
  },
});

function block(overrides: Partial<BoardBlock> & Pick<BoardBlock, "id" | "kind" | "position">): BoardBlock {
  return { item: null, colour: null, body: null, created_at: NOW, ...overrides };
}

const BOARD: BoardDetail = {
  id: "bd1",
  name: "Meera, sangeet",
  description: "Indigo and gold",
  created_at: NOW,
  updated_at: NOW,
  blocks: [
    block({ id: "b1", kind: "heading", position: 0, body: "The silks" }),
    block({ id: "b2", kind: "piece", position: 1, item: SILK, body: "For the lining" }),
    block({ id: "b3", kind: "colour", position: 2, colour: { hex: "#263b5e", name: "neel indigo", family: "blue" } }),
    block({ id: "b4", kind: "note", position: 3, body: "Keep the gold to the borders." }),
  ],
  colour_story: {
    measured: {
      dominant: [{ hex: "#d1291c", name: "sindoor red", share: 100, item_ids: [SILK.id] }],
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
        nearest: { hex: "#d1291c", name: "sindoor red", item_id: SILK.id, distance: 52.4 },
        on_pieces: false,
      },
    ],
    harmony: "complementary",
  },
};

const COLLECTION: CollectionDetail = {
  id: "c1",
  name: "Shortlist",
  description: null,
  is_public: false,
  created_at: NOW,
  updated_at: NOW,
  items: [
    { item: SILK, note: "Client liked this", position: 0, added_at: NOW },
    { item: makeItem({ id: "aaaaaaaa-0000-4000-8000-000000000002" }), note: null, position: 1, added_at: NOW },
  ],
  outfits: [],
};

beforeEach(() => {
  nav.setUrl("/boards/bd1/present");
  window.history.replaceState(null, "", "/");
});

describe("slides", () => {
  it("follow the board's order, between a cover and an end", () => {
    const slides = boardSlides(BOARD);
    expect(slides.map((s) => s.kind)).toEqual(["cover", "section", "piece", "colour", "note", "story", "end"]);
    expect(slides[0]).toEqual({ kind: "cover", title: "Meera, sangeet", description: "Indigo and gold", facts: "1 piece · 1 colour" });
    expect(slides[2]).toMatchObject({ kind: "piece", item: SILK, caption: "For the lining" });
    // A chosen colour says, in words, how it relates to what was measured.
    expect(slides[3]).toMatchObject({
      kind: "colour",
      hex: "#263b5e",
      match: expect.stringMatching(/^Not on the pieces yet; nearest is sindoor red on Silk dress/),
    });
    expect(slides[5]).toMatchObject({ kind: "story", harmony: "Complementary — opposite hues" });
  });

  it("leave out the colour story when there is none", () => {
    const empty = { ...BOARD, blocks: [], colour_story: { ...BOARD.colour_story, chosen: [], harmony: null, measured: { ...BOARD.colour_story.measured, dominant: [] } } };
    expect(boardSlides(empty).map((s) => s.kind)).toEqual(["cover", "end"]);
    expect(boardSlides(empty)[0]).toMatchObject({ facts: "0 pieces" });
  });

  it("come straight from a collection, with its notes as captions", () => {
    const slides = collectionSlides(COLLECTION);
    expect(slides.map((s) => s.kind)).toEqual(["cover", "piece", "piece", "end"]);
    expect(slides[0]).toMatchObject({ facts: "2 pieces" });
    expect(slides[1]).toMatchObject({ caption: "Client liked this" });
    expect(slides[2]).toMatchObject({ caption: null });
  });

  it("have short names", () => {
    expect(boardSlides(BOARD).map(slideTitle)).toEqual([
      "Meera, sangeet",
      "The silks",
      "Silk dress, French, 1883–85. Museum record C.I.53.63a, b.",
      "neel indigo #263B5E",
      "Note: Keep the gold to the borders.",
      "Colour story",
      "End of presentation",
    ]);
  });

  it("start from the slide named in the address", () => {
    expect(slideFromHash("", 5)).toBe(0);
    expect(slideFromHash("#slide-3", 5)).toBe(2);
    expect(slideFromHash("#slide-99", 5)).toBe(4);
    expect(slideFromHash("#slide-0", 5)).toBe(0);
    expect(slideFromHash("#other", 5)).toBe(0);
  });
});

describe("Presenter", () => {
  afterEach(() => {
    document.body.style.overflow = "";
  });

  function present() {
    return renderWithQuery(<Presenter slides={boardSlides(BOARD)} exitHref="/boards/bd1" name="Meera, sangeet" />);
  }
  const stage = () => screen.getByRole("region");
  const key = (k: string, target: Element | Window = window) => act(() => void fireEvent.keyDown(target, { key: k }));

  it("opens on the cover with the keyboard ready, and keeps the page behind still", () => {
    const { unmount } = present();
    expect(screen.getByRole("heading", { level: 1, name: "Presenting Meera, sangeet" })).toBeInTheDocument();
    expect(stage()).toHaveAttribute("aria-label", "Slide 1 of 7: Meera, sangeet");
    expect(stage()).toHaveAttribute("aria-roledescription", "slide");
    expect(stage()).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByRole("button", { name: "Previous slide" })).toHaveAttribute("aria-disabled", "true");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("moves with the arrow keys, Page keys, Home and End, and says where it is", () => {
    present();
    key("ArrowRight");
    expect(stage()).toHaveAttribute("aria-label", "Slide 2 of 7: The silks");
    expect(screen.getByText("Slide 2 of 7: The silks", { selector: "[aria-live]" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#slide-2");
    key("PageDown");
    expect(stage()).toHaveAttribute("aria-label", expect.stringMatching(/^Slide 3 of 7/));
    key("ArrowLeft");
    key("PageUp");
    key("ArrowLeft"); // already on the first slide
    expect(stage()).toHaveAttribute("aria-label", expect.stringMatching(/^Slide 1 of 7/));
    key("End");
    expect(stage()).toHaveAttribute("aria-label", "Slide 7 of 7: End of presentation");
    expect(screen.getByRole("button", { name: "Next slide" })).toHaveAttribute("aria-disabled", "true");
    key("ArrowRight");
    expect(stage()).toHaveAttribute("aria-label", expect.stringMatching(/^Slide 7 of 7/));
    key("Home");
    expect(stage()).toHaveAttribute("aria-label", expect.stringMatching(/^Slide 1 of 7/));
  });

  it("moves with the buttons, and Space advances only when no control has focus", () => {
    present();
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(stage()).toHaveAttribute("aria-label", expect.stringMatching(/^Slide 2 of 7/));
    key(" ", stage());
    expect(stage()).toHaveAttribute("aria-label", expect.stringMatching(/^Slide 3 of 7/));
    key(" ", screen.getByRole("button", { name: "Show details" }));
    expect(stage()).toHaveAttribute("aria-label", expect.stringMatching(/^Slide 3 of 7/));
    fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    expect(stage()).toHaveAttribute("aria-label", expect.stringMatching(/^Slide 2 of 7/));
  });

  it("starts from the slide in the address, so a reload keeps the place", () => {
    window.history.replaceState(null, "", "#slide-4");
    present();
    expect(stage()).toHaveAttribute("aria-label", "Slide 4 of 7: neel indigo #263B5E");
    expect(within(stage()).getByText(/^Not on the pieces yet; nearest is sindoor red/)).toBeInTheDocument();
  });

  it("leaves with Escape or the Exit link", () => {
    present();
    expect(screen.getByRole("link", { name: "Exit" })).toHaveAttribute("href", "/boards/bd1");
    key("Escape");
    expect(nav.router.push).toHaveBeenCalledWith("/boards/bd1");
  });

  it("hides internal detail until the presenter asks for it", () => {
    window.history.replaceState(null, "", "#slide-3");
    present();
    const slide = stage();
    expect(within(slide).getByRole("heading", { name: "For the lining" })).toBeInTheDocument();
    // The owner's note (with the museum record) and the source are always shown.
    expect(slide).toHaveTextContent("Museum record C.I.53.63a, b.");
    expect(within(slide).getByRole("link", { name: SILK.source_url! })).toBeInTheDocument();
    expect(within(slide).getByRole("list", { name: "Measured colours" })).toHaveTextContent("sindoor red");
    expect(within(slide).queryByLabelText("Piece details")).not.toBeInTheDocument();
    expect(slide).not.toHaveTextContent("AI guess");

    const toggle = screen.getByRole("button", { name: "Show details" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide details" })).toHaveAttribute("aria-pressed", "true");
    const details = within(stage()).getByLabelText("Piece details");
    expect(details).toHaveTextContent("Type: fabric");
    expect(details).toHaveTextContent("Thread suggested: garment (an AI guess, not used)");
    expect(details).toHaveTextContent("Status: completed");
    expect(details).toHaveTextContent("Colour shares: sindoor red 100%");
  });

  it("shows the colour story as measured and chosen, without inventing anything", () => {
    window.history.replaceState(null, "", "#slide-6");
    present();
    const slide = stage();
    expect(within(slide).getByRole("heading", { name: "Colour story" })).toBeInTheDocument();
    expect(slide).toHaveTextContent("Harmony: Complementary — opposite hues");
    expect(within(slide).getByRole("img", { name: "Measured colours: sindoor red" })).toBeInTheDocument();
    expect(within(slide).getByRole("list", { name: "Chosen colours" })).toHaveTextContent("neel indigo");
    expect(slide).toHaveTextContent("nothing here is written by a model");
  });
});

describe("presentations", () => {
  it("presents a board", async () => {
    routeFetch({ "GET /api/boards/bd1": () => Response.json(BOARD) });
    renderWithQuery(<BoardPresentation id="bd1" />);
    expect(await screen.findByRole("region", { name: "Slide 1 of 7: Meera, sangeet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Exit" })).toHaveAttribute("href", "/boards/bd1");
  });

  it("presents a collection directly", async () => {
    routeFetch({ "GET /api/collections/c1": () => Response.json(COLLECTION) });
    renderWithQuery(<CollectionPresentation id="c1" />);
    expect(await screen.findByRole("region", { name: "Slide 1 of 4: Shortlist" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Exit" })).toHaveAttribute("href", "/collections/c1");
  });

  it("says so when the board doesn't exist", async () => {
    routeFetch({
      "GET /api/boards/nope": () => Response.json({ error: { code: "not_found", message: "Not found", details: null } }, { status: 404 }),
    });
    renderWithQuery(<BoardPresentation id="nope" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("This board doesn't exist");
  });
});
