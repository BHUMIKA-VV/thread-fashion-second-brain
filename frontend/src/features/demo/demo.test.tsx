import { existsSync } from "node:fs";
import path from "node:path";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DemoBoardView } from "./demo-board";
import { DemoBrowse } from "./demo-browse";
import { creditParts, DEMO, demoPieces, filterDemo, NO_FILTERS, tagsByCategory } from "./demo-data";
import { DemoTags } from "./demo-sections";

const PUBLIC = path.resolve(import.meta.dirname, "../../../public");

describe("the demo dataset", () => {
  it("holds 12 to 30 pieces, each with its files, a credit and a public-domain licence", () => {
    expect(DEMO.pieces.length).toBeGreaterThanOrEqual(12);
    expect(DEMO.pieces.length).toBeLessThanOrEqual(30);
    for (const piece of DEMO.pieces) {
      expect(existsSync(path.join(PUBLIC, "demo", piece.image)), piece.image).toBe(true);
      expect(existsSync(path.join(PUBLIC, "demo", piece.thumbnail)), piece.thumbnail).toBe(true);
      expect(piece.licence).toMatch(/public domain \(CC0\)/i);
      expect(creditParts(piece.credit).url).toMatch(/^https:\/\/(www\.metmuseum\.org|clevelandart\.org)\//);
      expect(piece.palette.length).toBeGreaterThan(0);
    }
  });

  it("keeps each piece's museum object number in its note and its credit", () => {
    for (const piece of DEMO.pieces) {
      const record = piece.note?.match(/Museum record (.+)\.$/)?.[1];
      expect(record, piece.id).toBeTruthy();
      expect(creditParts(piece.credit).text.endsWith(record!), piece.id).toBe(true);
    }
  });

  it("only refers to pieces it holds", () => {
    const ids = new Set(DEMO.pieces.map((p) => p.id));
    const referenced = [
      ...DEMO.collections.flatMap((c) => c.pieces),
      ...DEMO.outfits.flatMap((o) => o.pieces),
      ...DEMO.pieces.flatMap((p) => [...p.similar_look, ...p.similar_palette].map((s) => s.id)),
    ];
    expect(referenced.filter((id) => !ids.has(id))).toEqual([]);
    expect(DEMO.outfits.length).toBeGreaterThanOrEqual(3);
  });

  it("never lets the model's guesses pass as facts", () => {
    for (const tag of DEMO.pieces.flatMap((p) => p.tags)) {
      if (tag.category === "weave") expect(tag.source).toBe("recorded"); // the model never suggests weave
      if (tag.category === "fabric" && tag.source === "ai") expect(tag.is_guess).toBe(true);
    }
  });

  it("puts in the reds collection only pieces measured with a red or pink of 10% or more", () => {
    const reds = DEMO.collections.find((c) => c.id === "colour-reds");
    expect(reds).toBeDefined();
    for (const piece of demoPieces(reds!.pieces)) {
      expect(piece.palette.some((c) => (c.family === "red" || c.family === "pink") && c.percentage >= 10), piece.id).toBe(true);
    }
  });
});

describe("filterDemo", () => {
  it("matches every word against title, tags and colour names", () => {
    const bandhani = filterDemo(DEMO.pieces, { ...NO_FILTERS, q: "bandhani" }).map((p) => p.id);
    expect(bandhani).toEqual(expect.arrayContaining(["bandhani-odhani", "bandhani-sari"]));
    expect(filterDemo(DEMO.pieces, { ...NO_FILTERS, q: "bandhani kashmir" })).toEqual([]);
    expect(filterDemo(DEMO.pieces, { ...NO_FILTERS, q: "  SILK   dress " }).map((p) => p.id)).toContain("silk-dress-1883");
  });

  it("filters by any chosen colour family and by type", () => {
    const blue = filterDemo(DEMO.pieces, { ...NO_FILTERS, families: ["blue"] });
    expect(blue.length).toBeGreaterThan(0);
    for (const p of blue) expect(p.palette.some((c) => c.family === "blue")).toBe(true);
    const accessories = filterDemo(DEMO.pieces, { ...NO_FILTERS, type: "accessory" });
    expect(accessories.length).toBeGreaterThan(0);
    expect(accessories.every((p) => p.type === "accessory")).toBe(true);
  });
});

describe("creditParts", () => {
  it("splits the museum link off the credit line", () => {
    expect(creditParts("The Met, Gift of X, 1984.83. https://www.metmuseum.org/art/collection/search/83934")).toEqual({
      text: "The Met, Gift of X, 1984.83",
      url: "https://www.metmuseum.org/art/collection/search/83934",
    });
    expect(creditParts("No link here")).toEqual({ text: "No link here", url: null });
  });
});

describe("DemoBrowse", () => {
  const families = DEMO.families.map((f) => f.family);

  // Renders all 30 demo pieces several times; under a full parallel run that nears the 5 s default.
  it("searches and filters in the browser without any request", { timeout: 15_000 }, () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<DemoBrowse pieces={DEMO.pieces} families={families} />);
    const grid = screen.getByRole("list", { name: "Demo pieces" });
    expect(within(grid).getAllByRole("listitem")).toHaveLength(DEMO.pieces.length);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search the demo" }), { target: { value: "bandhani" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(within(grid).getAllByRole("listitem")).toHaveLength(filterDemo(DEMO.pieces, { ...NO_FILTERS, q: "bandhani" }).length);
    expect(screen.getByText(/of 30 pieces/)).toHaveTextContent(`2 of ${DEMO.pieces.length} pieces`);

    fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
    expect(within(screen.getByRole("list", { name: "Demo pieces" })).getAllByRole("listitem")).toHaveLength(DEMO.pieces.length);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("toggles colour and type filters and shows an empty state", () => {
    render(<DemoBrowse pieces={DEMO.pieces} families={families} />);
    const blue = screen.getByRole("button", { name: "blue" });
    fireEvent.click(blue);
    expect(blue).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Accessories" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nothing-matches-this" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByText(/No demo pieces match/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Demo pieces" })).not.toBeInTheDocument();
  });
});

describe("DemoTags", () => {
  it("marks model suggestions and guesses, and leaves catalogue facts unmarked", () => {
    const piece = {
      ...DEMO.pieces[0],
      tags: [
        { category: "fabric", tag: "silk", source: "recorded" as const, is_guess: false },
        { category: "pattern", tag: "floral", source: "ai" as const, is_guess: false },
        { category: "craft", tag: "ikat", source: "ai" as const, is_guess: false },
      ],
    };
    render(<DemoTags piece={piece} />);
    expect(screen.getByText("silk").closest("dd")).toHaveTextContent(/^silk$/);
    expect(screen.getByText("floral").closest("dd")).toHaveTextContent("floral (suggested)");
    expect(tagsByCategory(piece.tags).map(([c]) => c)).toEqual(["fabric", "pattern", "craft"]);
  });
});

describe("the sample board", () => {
  const board = DEMO.boards[0];

  it("only refers to pieces the demo holds, and says it is a study, not for sale", () => {
    const ids = new Set(DEMO.pieces.map((p) => p.id));
    const missing = DEMO.boards.flatMap((b) => b.blocks.flatMap((x) => (x.kind === "piece" && !ids.has(x.piece) ? [x.piece] : [])));
    expect(missing).toEqual([]);
    expect(board.description).toMatch(/not a historical ensemble/);
    expect(board.description).toMatch(/nothing on it is for sale/);
    for (const c of board.colour_story.chosen) expect(board.blocks[c.block].kind).toBe("colour");
  });

  it("shows its blocks in order, a credit under every piece, and the calculated colour story", () => {
    render(<DemoBoardView board={board} />);
    expect(screen.getByRole("link", { name: "Present" })).toHaveAttribute("href", "/demo/boards/wine-red-and-gold/present");
    const blocks = screen.getByRole("list", { name: "Blocks on this board" });
    expect(within(blocks).getAllByRole("heading").map((h) => h.textContent)).toEqual(["Wine reds", "Gold and cream"]);
    for (const piece of demoPieces(board.blocks.flatMap((b) => (b.kind === "piece" ? [b.piece] : [])))) {
      expect(blocks, piece.id).toHaveTextContent(`${creditParts(piece.credit).text}.`);
    }
    expect(screen.getByText("Harmony:").parentElement).toHaveTextContent(/Analogous/);
    expect(screen.getByRole("img", { name: /^Measured colours: wine red/ })).toBeInTheDocument();
    const chosen = screen.getByRole("list", { name: "Chosen colours and their nearest measured colour" });
    expect(within(chosen).getAllByRole("listitem")).toHaveLength(2);
    expect(chosen).toHaveTextContent("camel");
    expect(screen.getByText(/Nothing here is written by a model/)).toBeInTheDocument();
  });
});
