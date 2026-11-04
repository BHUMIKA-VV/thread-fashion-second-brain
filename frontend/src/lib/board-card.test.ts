import { describe, expect, it } from "vitest";

import { BOARD_CARD, boardCardFilename, boardCardPlan, COLUMN_CHOICES, STORY_HEIGHT, wrapText, type CardBlock, type Wrap } from "./board-card";

// A fixed-width "font": every character is 10px wide, so wrapping is predictable.
const measure = (s: string) => s.length * 10;
const wrap: Wrap = (text, width, _style, maxLines) => wrapText(measure, text, width, maxLines);

const piece = (text = "Linen dupatta", caption: string | null = null): CardBlock => ({ kind: "piece", text, caption });
const colour: CardBlock = { kind: "colour", text: "neel indigo #263B5E", caption: null, hex: "#263b5e" };
const heading = (text = "Colour story"): CardBlock => ({ kind: "heading", text, caption: null });
const note = (text = "Keep the gold to the borders."): CardBlock => ({ kind: "note", text, caption: null });

function plan(blocks: CardBlock[], hasStory = false, description: string | null = null) {
  return boardCardPlan({ name: "Meera, sangeet", description, blocks, hasStory }, wrap);
}

describe("wrapText", () => {
  it("breaks at spaces and keeps paragraphs", () => {
    expect(wrapText(measure, "one two three", 70, 5)).toEqual(["one two", "three"]);
    expect(wrapText(measure, "one\ntwo", 200, 5)).toEqual(["one", "two"]);
  });

  it("breaks a word wider than the line by characters", () => {
    expect(wrapText(measure, "abcdefghij", 40, 5)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("keeps at most the given lines and says it shortened them", () => {
    const lines = wrapText(measure, "aa bb cc dd ee ff", 50, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
    expect(measure(lines[1])).toBeLessThanOrEqual(50);
  });

  it("drops trailing punctuation before the ellipsis", () => {
    expect(wrapText(measure, "Gold here. More text.", 100, 1)).toEqual(["Gold here…"]);
  });
});

describe("boardCardPlan", () => {
  it("lays blocks out in the board's order, three to a row like the editor", () => {
    const p = plan([heading(), piece(), colour, piece("Silk"), note()]);
    expect(p.columns).toBe(3);
    expect(p.blocks.map((b) => b.kind)).toEqual(["heading", "piece", "colour", "piece", "note"]);
    const [h, a, b, c, n] = p.blocks;
    // The heading has a row of its own; the next three share a row; the note starts the next.
    expect(a.box.y).toBeGreaterThan(h.box.y + h.box.h);
    expect(new Set([a.box.y, b.box.y, c.box.y]).size).toBe(1);
    expect(a.box.x).toBeLessThan(b.box.x);
    expect(n.box.y).toBeGreaterThan(a.box.y);
    // A note spans two columns; pieces and colours get a 3:4 tile.
    expect(n.box.w).toBeGreaterThan(a.box.w * 2);
    expect(a.tile!.h / a.tile!.w).toBeCloseTo(4 / 3, 1);
    expect(n.tile).toBeNull();
  });

  it("keeps every block inside the margins and the image", () => {
    const p = plan([heading(), ...Array.from({ length: 20 }, (_, i) => (i % 3 ? piece(`Piece ${i}`, "A caption") : note()))], true);
    for (const b of p.blocks) {
      expect(b.box.x).toBeGreaterThanOrEqual(BOARD_CARD.margin);
      expect(b.box.x + b.box.w).toBeLessThanOrEqual(BOARD_CARD.width - BOARD_CARD.margin + 0.01);
      expect(b.box.y + b.box.h).toBeLessThanOrEqual(p.storyY!);
      for (const line of b.lines) expect(line.y).toBeLessThanOrEqual(b.box.y + b.box.h);
    }
    expect(p.height).toBe(Math.round(p.storyY! + STORY_HEIGHT + BOARD_CARD.margin));
  });

  it("writes the name, the description and each caption", () => {
    const p = plan([piece("Linen dupatta", "For the lining")], false, "Indigo and gold");
    expect(p.header.map((l) => [l.style, l.text])).toEqual([
      ["title", "Meera, sangeet"],
      ["description", "Indigo and gold"],
    ]);
    expect(p.blocks[0].lines.map((l) => [l.style, l.text])).toEqual([
      ["label", "Linen dupatta"],
      ["caption", "For the lining"],
    ]);
  });

  it("leaves room for the colour story only when there is one", () => {
    expect(plan([piece()], false).storyY).toBeNull();
    expect(plan([piece()], true).storyY).not.toBeNull();
  });

  it("adds columns so a full board stays under the height cap", () => {
    const full = plan(Array.from({ length: 120 }, (_, i) => piece(`Piece ${i}`, "A caption on two lines")), true);
    expect(full.blocks).toHaveLength(120);
    expect(full.columns).toBeGreaterThan(3);
    expect(COLUMN_CHOICES).toContain(full.columns);
    expect(full.height).toBeLessThanOrEqual(BOARD_CARD.maxHeight);
  });

  it("shortens long notes on the image rather than growing past the cap", () => {
    const long = "word ".repeat(400).trim();
    const p = plan(Array.from({ length: 120 }, () => note(long)));
    expect(p.height).toBeLessThanOrEqual(BOARD_CARD.maxHeight);
    expect(p.blocks.every((b) => b.lines.at(-1)!.text.endsWith("…"))).toBe(true);
  });
});

describe("boardCardFilename", () => {
  it("makes a safe filename", () => {
    expect(boardCardFilename("Meera: Sangeet / Indigo")).toBe("thread-board-meera-sangeet-indigo.png");
    expect(boardCardFilename("संगीत")).toBe("thread-board-untitled.png");
  });
});
