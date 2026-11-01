import { describe, expect, it } from "vitest";

import { layoutPlan, moved, type OutfitLayout } from "./outfit-layout";
import { cardImageSource, OUTFIT_CARD, outfitCardFilename, outfitCardPlan } from "./outfit-card";

const LAYOUTS: OutfitLayout[] = ["feature", "grid", "column"];

function overlaps(layout: OutfitLayout, count: number): boolean {
  const seen = new Set<string>();
  for (const cell of layoutPlan(layout, count).cells) {
    for (let c = cell.col; c < cell.col + cell.colSpan; c++) {
      for (let r = cell.row; r < cell.row + cell.rowSpan; r++) {
        if (seen.has(`${c},${r}`)) return true;
        seen.add(`${c},${r}`);
      }
    }
  }
  return false;
}

describe("layoutPlan", () => {
  it("gives every piece one non-overlapping cell inside the grid, for 1 to 12 pieces", () => {
    for (const layout of LAYOUTS) {
      for (let count = 1; count <= 12; count++) {
        const plan = layoutPlan(layout, count);
        expect(plan.cells).toHaveLength(count);
        expect(overlaps(layout, count)).toBe(false);
        for (const cell of plan.cells) {
          expect(cell.col + cell.colSpan - 1).toBeLessThanOrEqual(plan.cols);
          expect(cell.row + cell.rowSpan - 1).toBeLessThanOrEqual(plan.rows);
        }
      }
    }
  });

  it("makes the first piece the feature", () => {
    expect(layoutPlan("feature", 5).cells[0]).toEqual({ col: 1, row: 1, colSpan: 2, rowSpan: 2 });
    expect(layoutPlan("feature", 2).cells[1]).toEqual({ col: 3, row: 1, colSpan: 1, rowSpan: 2 });
    expect(layoutPlan("feature", 1).cols).toBe(1);
  });

  it("never leaves a gap in a feature composition", () => {
    for (let count = 1; count <= 12; count++) {
      const plan = layoutPlan("feature", count);
      const filled = plan.cells.reduce((sum, cell) => sum + cell.colSpan * cell.rowSpan, 0);
      expect(filled, `${count} pieces`).toBe(plan.cols * plan.rows);
    }
    expect(layoutPlan("feature", 4).cells[3]).toEqual({ col: 1, row: 3, colSpan: 3, rowSpan: 1 });
    expect(layoutPlan("feature", 5).cells.slice(3)).toEqual([
      { col: 1, row: 3, colSpan: 2, rowSpan: 1 },
      { col: 3, row: 3, colSpan: 1, rowSpan: 1 },
    ]);
    expect(layoutPlan("feature", 6).cells[5]).toEqual({ col: 3, row: 3, colSpan: 1, rowSpan: 1 });
  });

  it("keeps even counts tidy in the grid and stacks the column", () => {
    expect(layoutPlan("grid", 4).cols).toBe(2);
    expect(layoutPlan("grid", 6).cols).toBe(3);
    expect(layoutPlan("column", 3)).toMatchObject({ cols: 1, rows: 3 });
  });

  it("handles an empty outfit", () => {
    expect(layoutPlan("feature", 0).cells).toEqual([]);
  });
});

describe("moved", () => {
  it("moves one entry without changing the original", () => {
    const list = ["a", "b", "c"];
    expect(moved(list, 0, 2)).toEqual(["b", "c", "a"]);
    expect(list).toEqual(["a", "b", "c"]);
  });

  it("ignores moves out of range", () => {
    expect(moved(["a", "b"], 0, 2)).toEqual(["a", "b"]);
    expect(moved(["a", "b"], -1, 0)).toEqual(["a", "b"]);
  });
});

describe("outfit card plan", () => {
  it("keeps every tile on the card and the canvas bounded at 12 pieces", () => {
    for (const layout of LAYOUTS) {
      for (let count = 1; count <= 12; count++) {
        const { height, tiles } = outfitCardPlan(layout, count);
        expect(tiles).toHaveLength(count);
        expect(height).toBeLessThanOrEqual(OUTFIT_CARD.maxPhotosHeight + 400);
        for (const tile of tiles) {
          expect(tile.x + tile.w).toBeLessThanOrEqual(OUTFIT_CARD.width - OUTFIT_CARD.margin + 0.01);
          expect(tile.y + tile.h).toBeLessThan(height);
          expect(tile.w).toBeGreaterThan(0);
        }
      }
    }
  });

  it("uses the thumbnail on low-memory devices and for very large files", () => {
    const small = { imageUrl: "/full", thumbnailUrl: "/thumb", fileSize: 1000 };
    expect(cardImageSource(small, false)).toBe("/full");
    expect(cardImageSource(small, true)).toBe("/thumb");
    expect(cardImageSource({ ...small, fileSize: 20_000_000 }, false)).toBe("/thumb");
  });

  it("makes a safe filename", () => {
    expect(outfitCardFilename("Sangeet: Evening / Look")).toBe("thread-outfit-sangeet-evening-look.png");
    expect(outfitCardFilename("संगीत")).toBe("thread-outfit-untitled.png");
  });
});
