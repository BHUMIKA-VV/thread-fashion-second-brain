/**
 * The board image: a PNG of a moodboard drawn in the browser, in the board's own order, with
 * its pieces, colours, headings, notes and its calculated colour story. No watermark.
 *
 * Memory: tiles are small, so every piece is drawn from its stored thumbnail, loaded, drawn and
 * released one at a time. The canvas is kept under a fixed height by adding columns and then
 * shortening long notes, so even a full board of 120 blocks stays a few tens of megabytes.
 * A photograph that fails to load leaves a labelled blank tile and is reported.
 */

import { cssFont, loadImage } from "@/lib/swatch-card";
import type { BoardBlockKind } from "@/types/api";

export const BOARD_CARD = {
  width: 1080,
  margin: 72,
  gap: 24,
  maxHeight: 7200,
} as const;
/** Columns tried in turn until the board fits; the editor shows three. */
export const COLUMN_CHOICES = [3, 4, 5, 6] as const;
/** The most lines a note keeps on the image, tried in turn; printing keeps every word. */
const NOTE_LINES = [14, 8, 4] as const;
const TILE_ASPECT = 4 / 3; // height / width, as in the editor

export type TextStyle = "title" | "description" | "heading" | "note" | "label" | "caption" | "storyTitle" | "story";
const STYLE: Record<TextStyle, { size: number; lineHeight: number; display: boolean }> = {
  title: { size: 64, lineHeight: 72, display: true },
  description: { size: 24, lineHeight: 34, display: false },
  heading: { size: 40, lineHeight: 48, display: true },
  note: { size: 24, lineHeight: 34, display: false },
  label: { size: 20, lineHeight: 26, display: false },
  caption: { size: 20, lineHeight: 26, display: false },
  storyTitle: { size: 36, lineHeight: 44, display: true },
  story: { size: 22, lineHeight: 30, display: false },
};

const PAPER = "#FFFCF7";
const INK = "#202321";
const MUTED = "#5F6352";
const BLANK = "#EFE7DA";
const CLAY = "#AD4F36";
const LINE = "#D9C8B1";

/** Splits text into lines no wider than `width`, keeping at most `maxLines` (the last ends in "…"). */
export function wrapText(measure: (s: string) => number, text: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next) <= width) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      // A word wider than the line is broken by characters.
      let rest = word;
      while (measure(rest) > width && rest.length > 1) {
        let end = rest.length - 1;
        while (end > 1 && measure(rest.slice(0, end)) > width) end--;
        lines.push(rest.slice(0, end));
        rest = rest.slice(end);
      }
      line = rest;
    }
    if (line) lines.push(line);
  }
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = `${kept[maxLines - 1].replace(/[\s.,;:]+$/, "")}…`;
  while (last.length > 1 && measure(last) > width) last = `${last.slice(0, -2).trimEnd()}…`;
  kept[maxLines - 1] = last;
  return kept;
}

export type Wrap = (text: string, width: number, style: TextStyle, maxLines: number) => string[];

export type CardBlock = {
  kind: BoardBlockKind;
  /** Piece: its name; colour: name and hex; heading and note: their text. */
  text: string;
  /** The caption of a piece or a colour. */
  caption: string | null;
  /** Colour blocks only. */
  hex?: string;
};

export type Rect = { x: number; y: number; w: number; h: number };
export type PlacedLine = {
  text: string;
  style: TextStyle;
  x: number;
  y: number;
  width: number;
};
export type PlacedBlock = {
  index: number;
  kind: BoardBlockKind;
  box: Rect;
  tile: Rect | null;
  lines: PlacedLine[];
};

export type BoardCardPlan = {
  columns: number;
  height: number;
  header: PlacedLine[];
  blocks: PlacedBlock[];
  /** Where the colour story starts, or null when the board has none to show. */
  storyY: number | null;
};

export const STORY_HEIGHT = 230;

/** Lines from `top`, each on its baseline. */
function stack(texts: string[], style: TextStyle, x: number, top: number, width: number): PlacedLine[] {
  const { size, lineHeight } = STYLE[style];
  return texts.map((text, i) => ({
    text,
    style,
    x,
    y: top + i * lineHeight + Math.round(size * 0.9),
    width,
  }));
}

function linesHeight(count: number, style: TextStyle): number {
  return count * STYLE[style].lineHeight;
}

/** Where everything goes, and how tall the image is: pure, so it can be tested without a canvas. */
export function boardCardPlan(
  board: {
    name: string;
    description: string | null;
    blocks: CardBlock[];
    hasStory: boolean;
  },
  wrap: Wrap,
): BoardCardPlan {
  let plan: BoardCardPlan | null = null;
  for (const noteLines of NOTE_LINES) {
    for (const columns of COLUMN_CHOICES) {
      plan = layout(board, wrap, columns, noteLines);
      if (plan.height <= BOARD_CARD.maxHeight) return plan;
    }
  }
  return plan!; // the tightest layout tried; only a board of very long notes reaches this
}

function layout(
  board: {
    name: string;
    description: string | null;
    blocks: CardBlock[];
    hasStory: boolean;
  },
  wrap: Wrap,
  columns: number,
  noteLines: number,
): BoardCardPlan {
  const { width, margin, gap } = BOARD_CARD;
  const area = width - 2 * margin;

  const header = stack(wrap(board.name, area, "title", 2), "title", margin, margin, area);
  let y = margin + linesHeight(header.length, "title");
  if (board.description) {
    const description = stack(wrap(board.description, area, "description", 3), "description", margin, y + 12, area);
    header.push(...description);
    y += 12 + linesHeight(description.length, "description");
  }
  y += 48;

  const cell = (area - gap * (columns - 1)) / columns;
  const blocks: PlacedBlock[] = [];
  let row: PlacedBlock[] = [];
  let col = 0;
  const endRow = () => {
    if (row.length === 0) return;
    y += Math.max(...row.map((b) => b.box.h)) + gap;
    row = [];
    col = 0;
  };

  board.blocks.forEach((block, index) => {
    if (block.kind === "heading") {
      endRow();
      const lines = stack(wrap(block.text, area, "heading", 3), "heading", margin, y + 16, area);
      const placed = {
        index,
        kind: block.kind,
        box: {
          x: margin,
          y,
          w: area,
          h: 16 + linesHeight(lines.length, "heading"),
        },
        tile: null,
        lines,
      };
      blocks.push(placed);
      row = [placed];
      endRow();
      return;
    }
    const span = block.kind === "note" ? Math.min(2, columns) : 1;
    if (col + span > columns) endRow();
    const x = margin + col * (cell + gap);
    const w = span * cell + (span - 1) * gap;
    let placed: PlacedBlock;
    if (block.kind === "note") {
      const lines = stack(wrap(block.text, w - 20, "note", noteLines), "note", x + 20, y, w - 20);
      placed = {
        index,
        kind: block.kind,
        box: { x, y, w, h: linesHeight(lines.length, "note") },
        tile: null,
        lines,
      };
    } else {
      const tile = { x, y, w, h: Math.round(w * TILE_ASPECT) };
      const label = stack(wrap(block.text, w, "label", 2), "label", x, tile.y + tile.h + 10, w);
      const below = tile.y + tile.h + 10 + linesHeight(label.length, "label");
      const caption = block.caption ? stack(wrap(block.caption, w, "caption", 3), "caption", x, below, w) : [];
      const h = tile.h + 10 + linesHeight(label.length, "label") + linesHeight(caption.length, "caption");
      placed = {
        index,
        kind: block.kind,
        box: { x, y, w, h },
        tile,
        lines: [...label, ...caption],
      };
    }
    blocks.push(placed);
    row.push(placed);
    col += span;
  });
  endRow();

  const storyY = board.hasStory ? y + 24 : null;
  const height = Math.round((storyY !== null ? storyY + STORY_HEIGHT : y - gap) + margin);
  return { columns, height, header, blocks, storyY };
}

export function boardCardFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `thread-board-${slug || "untitled"}.png`;
}

export type CardStoryColour = { hex: string; name: string; share: number };

function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, box: Rect) {
  const scale = Math.max(box.w / image.naturalWidth, box.h / image.naturalHeight);
  const sw = box.w / scale;
  const sh = box.h / scale;
  ctx.drawImage(image, (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) / 2, sw, sh, box.x, box.y, box.w, box.h);
}

export async function renderBoardCard(options: {
  name: string;
  description: string | null;
  blocks: (CardBlock & { thumbnailUrl?: string })[];
  story: { harmony: string | null; colours: CardStoryColour[] };
}): Promise<{ blob: Blob; failed: number }> {
  const display = cssFont("--font-fraunces", "Georgia, serif");
  const sans = cssFont("--font-inter", "system-ui, sans-serif");
  await Promise.all([document.fonts.load(`64px ${display}`), document.fonts.load(`24px ${sans}`)]);
  const font = (style: TextStyle) => `${STYLE[style].size}px ${STYLE[style].display ? display : sans}`;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't draw the board.");
  const wrap: Wrap = (text, width, style, maxLines) => {
    ctx.font = font(style);
    return wrapText((s) => ctx.measureText(s).width, text, width, maxLines);
  };
  const { story } = options;
  const hasStory = story.harmony !== null || story.colours.length > 0;
  const plan = boardCardPlan(
    {
      name: options.name,
      description: options.description,
      blocks: options.blocks,
      hasStory,
    },
    wrap,
  );

  const { width, margin } = BOARD_CARD;
  canvas.width = width;
  canvas.height = plan.height;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, plan.height);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const write = (line: PlacedLine, colour: string) => {
    ctx.fillStyle = colour;
    ctx.font = font(line.style);
    ctx.fillText(line.text, line.x, line.y, line.width);
  };
  for (const line of plan.header) write(line, line.style === "title" ? INK : MUTED);

  let failed = 0;
  // One at a time: each photograph is released before the next is decoded.
  for (const placed of plan.blocks) {
    const block = options.blocks[placed.index];
    if (placed.kind === "note") {
      ctx.fillStyle = CLAY;
      ctx.fillRect(placed.box.x, placed.box.y, 3, placed.box.h);
    }
    if (placed.tile && block.kind === "colour" && block.hex) {
      ctx.fillStyle = block.hex;
      ctx.fillRect(placed.tile.x, placed.tile.y, placed.tile.w, placed.tile.h);
      ctx.strokeStyle = LINE;
      ctx.lineWidth = 1;
      ctx.strokeRect(placed.tile.x + 0.5, placed.tile.y + 0.5, placed.tile.w - 1, placed.tile.h - 1);
    }
    if (placed.tile && block.kind === "piece") {
      try {
        if (!block.thumbnailUrl) throw new Error("No image");
        const image = await loadImage(block.thumbnailUrl);
        drawCover(ctx, image, placed.tile);
        image.src = "";
      } catch {
        failed++;
        const { x, y, w, h } = placed.tile;
        ctx.fillStyle = BLANK;
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = MUTED;
        ctx.font = font("caption");
        ctx.textAlign = "center";
        ctx.fillText("Image unavailable", x + w / 2, y + h / 2, w - 12);
        ctx.textAlign = "left";
      }
    }
    for (const line of placed.lines) write(line, line.style === "caption" ? MUTED : INK);
  }

  if (plan.storyY !== null) {
    let y = plan.storyY;
    ctx.fillStyle = LINE;
    ctx.fillRect(margin, y, width - 2 * margin, 1);
    y += 24;
    write(
      {
        text: "Colour story",
        style: "storyTitle",
        x: margin,
        y: y + 34,
        width: width - 2 * margin,
      },
      INK,
    );
    y += STYLE.storyTitle.lineHeight + 8;
    if (story.harmony) {
      write(
        {
          text: `Harmony: ${story.harmony}`,
          style: "story",
          x: margin,
          y: y + 22,
          width: width - 2 * margin,
        },
        MUTED,
      );
    }
    y += STYLE.story.lineHeight + 16;
    const total = story.colours.reduce((sum, c) => sum + c.share, 0) || 1;
    let x: number = margin;
    story.colours.forEach((colour, i) => {
      const right = i === story.colours.length - 1 ? width - margin : x + ((width - 2 * margin) * colour.share) / total;
      ctx.fillStyle = colour.hex;
      ctx.fillRect(x, y, right - x, 28);
      x = right;
    });
    if (story.colours.length > 0) {
      const names = story.colours.map((c) => c.name.replace(/^./, (l) => l.toUpperCase())).join("  ·  ");
      const [line] = wrap(names, width - 2 * margin, "story", 1);
      write(
        {
          text: line,
          style: "story",
          x: margin,
          y: y + 28 + 40,
          width: width - 2 * margin,
        },
        MUTED,
      );
    }
  }

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The board image could not be saved."))), "image/png"),
  );
  // Let the browser reclaim the canvas right away, which matters on phones.
  canvas.width = 0;
  canvas.height = 0;
  return { blob, failed };
}
