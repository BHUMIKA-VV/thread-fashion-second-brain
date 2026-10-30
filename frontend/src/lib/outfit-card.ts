/**
 * The outfit reference card: a PNG drawn in the browser from the real photographs, in the same
 * layout as the studio, with the outfit's name and calculated colours. No watermark.
 *
 * Memory: photos are loaded, drawn and released one at a time, and the canvas size is capped,
 * so 12 large photos are never held together. Phones and very large files use the stored
 * thumbnail. A photo that fails to load leaves a labelled blank tile and is reported.
 */

import { cssFont, loadImage } from "@/lib/swatch-card";
import { layoutPlan, type LayoutCell, type OutfitLayout } from "@/lib/outfit-layout";

export const OUTFIT_CARD = { width: 1080, margin: 72, gap: 12, maxPhotosHeight: 2400 } as const;
const HEADER = 190;
const FOOTER = 170;
const LARGE_FILE_BYTES = 6 * 1024 * 1024;

const PAPER = "#FFFCF7";
const INK = "#202321";
const MUTED = "#5F6352";
const BLANK = "#EFE7DA";

export type CardPiece = {
  imageUrl: string;
  thumbnailUrl: string;
  fileSize: number;
};

export type CardColour = { hex: string; name: string; share: number };

export type Rect = { x: number; y: number; w: number; h: number };

/** Where the photos go, and how tall the card is: pure, so it can be tested without a canvas. */
export function outfitCardPlan(layout: OutfitLayout, count: number): { height: number; tiles: Rect[] } {
  const { margin, gap, width, maxPhotosHeight } = OUTFIT_CARD;
  const plan = layoutPlan(layout, count);
  const areaWidth = width - 2 * margin;
  const cellW = (areaWidth - gap * (plan.cols - 1)) / plan.cols;
  const available = (maxPhotosHeight - gap * Math.max(0, plan.rows - 1)) / Math.max(1, plan.rows);
  const cellH = Math.min(cellW / plan.cellAspect, available);
  const place = ({ col, row, colSpan, rowSpan }: LayoutCell): Rect => ({
    x: margin + (col - 1) * (cellW + gap),
    y: HEADER + (row - 1) * (cellH + gap),
    w: colSpan * cellW + (colSpan - 1) * gap,
    h: rowSpan * cellH + (rowSpan - 1) * gap,
  });
  const photos = plan.rows * cellH + Math.max(0, plan.rows - 1) * gap;
  return { height: Math.round(HEADER + photos + FOOTER), tiles: plan.cells.map(place) };
}

export function isLowMemory(): boolean {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return (memory !== undefined && memory <= 4) || window.innerWidth < 768;
}

/** Which stored image to draw: the original, unless the device or the file makes that risky. */
export function cardImageSource(piece: CardPiece, lowMemory: boolean): string {
  return lowMemory || piece.fileSize > LARGE_FILE_BYTES ? piece.thumbnailUrl : piece.imageUrl;
}

export function outfitCardFilename(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `thread-outfit-${slug || "untitled"}.png`;
}

function fitted(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end).trimEnd()}…`).width > width) end--;
  return `${text.slice(0, end).trimEnd()}…`;
}

function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, box: Rect) {
  const scale = Math.max(box.w / image.naturalWidth, box.h / image.naturalHeight);
  const sw = box.w / scale;
  const sh = box.h / scale;
  ctx.drawImage(image, (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) / 2, sw, sh, box.x, box.y, box.w, box.h);
}

export async function renderOutfitCard(options: {
  name: string;
  subtitle: string;
  layout: OutfitLayout;
  pieces: CardPiece[];
  colours: CardColour[];
  lowMemory?: boolean;
}): Promise<{ blob: Blob; failed: number }> {
  const display = cssFont("--font-fraunces", "Georgia, serif");
  const sans = cssFont("--font-inter", "system-ui, sans-serif");
  await Promise.all([document.fonts.load(`64px ${display}`), document.fonts.load(`24px ${sans}`)]);

  const plan = outfitCardPlan(options.layout, options.pieces.length);
  const { width, margin } = OUTFIT_CARD;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = plan.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't draw the card.");

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, plan.height);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = INK;
  ctx.font = `64px ${display}`;
  ctx.fillText(fitted(ctx, options.name, width - 2 * margin), margin, 118);
  if (options.subtitle) {
    ctx.fillStyle = MUTED;
    ctx.font = `24px ${sans}`;
    ctx.fillText(fitted(ctx, options.subtitle, width - 2 * margin), margin, 160);
  }

  let failed = 0;
  // One at a time: each photo is released before the next is decoded.
  for (const [index, piece] of options.pieces.entries()) {
    const box = plan.tiles[index];
    try {
      const image = await loadImage(cardImageSource(piece, options.lowMemory ?? isLowMemory()));
      drawCover(ctx, image, box);
      image.src = "";
    } catch {
      failed++;
      ctx.fillStyle = BLANK;
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.fillStyle = MUTED;
      ctx.font = `22px ${sans}`;
      ctx.textAlign = "center";
      ctx.fillText("Image unavailable", box.x + box.w / 2, box.y + box.h / 2, box.w - 16);
      ctx.textAlign = "left";
    }
  }
  if (failed > 0 && failed === options.pieces.length) throw new Error("None of the photographs could be loaded.");

  const bandY = plan.height - FOOTER + 36;
  const total = options.colours.reduce((sum, c) => sum + c.share, 0) || 1;
  let x: number = margin;
  options.colours.forEach((colour, i) => {
    const right = i === options.colours.length - 1 ? width - margin : x + ((width - 2 * margin) * colour.share) / total;
    ctx.fillStyle = colour.hex;
    ctx.fillRect(x, bandY, right - x, 28);
    x = right;
  });
  if (options.colours.length > 0) {
    ctx.fillStyle = MUTED;
    ctx.font = `24px ${sans}`;
    const names = options.colours.map((c) => c.name.replace(/^./, (l) => l.toUpperCase())).join("  ·  ");
    ctx.fillText(fitted(ctx, names, width - 2 * margin), margin, bandY + 72);
  }

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The card could not be saved."))), "image/png"),
  );
  // Let the browser reclaim the canvas right away, which matters on phones.
  canvas.width = 0;
  canvas.height = 0;
  return { blob, failed };
}
