/**
 * The three structured layouts of Outfit Studio. Pure, and used by both the page and the PNG
 * export, so what you compose is what you download.
 */

export type OutfitLayout = "feature" | "grid" | "column";

export type LayoutCell = { col: number; row: number; colSpan: number; rowSpan: number };

export type LayoutPlan = {
  cols: number;
  rows: number;
  /** One cell per piece, in order. Rows and columns start at 1, as in CSS grid. */
  cells: LayoutCell[];
  /** Width / height of a single-span cell. */
  cellAspect: number;
};

const PORTRAIT = 4 / 5;
const LANDSCAPE = 5 / 4;

function plain(cols: number, count: number, cellAspect: number): LayoutPlan {
  const cells = Array.from({ length: count }, (_, i) => ({
    col: (i % cols) + 1,
    row: Math.floor(i / cols) + 1,
    colSpan: 1,
    rowSpan: 1,
  }));
  return { cols, rows: Math.ceil(count / cols), cells, cellAspect };
}

export function layoutPlan(layout: OutfitLayout, count: number): LayoutPlan {
  if (layout === "column") return plain(1, count, LANDSCAPE);
  if (layout === "grid" || count <= 1) {
    return plain(count <= 1 ? 1 : count === 2 || count === 4 ? 2 : 3, count, PORTRAIT);
  }
  // Feature: the first piece fills two columns and two rows; the next two sit beside it (one
  // alone takes the full height), and the rest continue below in rows of three. A last row
  // that isn't full stretches to the full width, so a feature composition never leaves a gap.
  const cells: LayoutCell[] = [{ col: 1, row: 1, colSpan: 2, rowSpan: 2 }];
  if (count === 2) {
    cells.push({ col: 3, row: 1, colSpan: 1, rowSpan: 2 });
  } else {
    cells.push({ col: 3, row: 1, colSpan: 1, rowSpan: 1 }, { col: 3, row: 2, colSpan: 1, rowSpan: 1 });
    const rest = count - 3;
    const left = rest % 3;
    for (let i = 0; i < rest; i++) {
      const row = Math.floor(i / 3) + 3;
      if (i < rest - left) cells.push({ col: (i % 3) + 1, row, colSpan: 1, rowSpan: 1 });
      else if (left === 1) cells.push({ col: 1, row, colSpan: 3, rowSpan: 1 });
      else if (i === rest - 2) cells.push({ col: 1, row, colSpan: 2, rowSpan: 1 });
      else cells.push({ col: 3, row, colSpan: 1, rowSpan: 1 });
    }
  }
  return { cols: 3, rows: count <= 3 ? 2 : 2 + Math.ceil((count - 3) / 3), cells, cellAspect: PORTRAIT };
}

/** Move one entry, returning a new list; out-of-range moves return it unchanged. */
export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return next;
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry);
  return next;
}
