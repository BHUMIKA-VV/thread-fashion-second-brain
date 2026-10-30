/**
 * The swatch card: a 1080 x 1350 PNG of one piece, drawn in the browser so it uses the
 * site's own fonts. Photo on top, the measured palette as a proportional band, up to five
 * colours with names, hex values and shares, then the wordmark and the record number.
 * Nothing on it is invented: every colour and number comes from the stored palette.
 */

export const CARD = { width: 1080, height: 1350, margin: 72 } as const;

const PHOTO = { x: CARD.margin, y: CARD.margin, w: CARD.width - 2 * CARD.margin, h: 720 };
const BAND = { y: PHOTO.y + PHOTO.h + 24, h: 44 };
const ROWS = { y: BAND.y + BAND.h + 44, step: 62, max: 5 };
const FOOTER_Y = CARD.height - CARD.margin;

const PAPER = "#FFFCF7";
const INK = "#202321";
const MUTED = "#5F6352";
const LINE = "#D9C8B1";

export type CardColour = { hex: string; name: string; percentage: number };

export type CardLayout = {
  band: { x: number; width: number; hex: string }[];
  rows: { y: number; hex: string; name: string; code: string; share: string }[];
};

/** Where everything goes: pure, so it can be tested without a canvas. */
export function cardLayout(colours: CardColour[]): CardLayout {
  const total = colours.reduce((sum, c) => sum + Math.max(0, c.percentage), 0) || 1;
  let x: number = PHOTO.x;
  const band = colours.map((c, i) => {
    const right = i === colours.length - 1 ? PHOTO.x + PHOTO.w : x + Math.round((PHOTO.w * Math.max(0, c.percentage)) / total);
    const segment = { x, width: Math.max(0, right - x), hex: c.hex };
    x = right;
    return segment;
  });
  const rows = [...colours]
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, ROWS.max)
    .map((c, i) => ({
      y: ROWS.y + i * ROWS.step,
      hex: c.hex,
      name: c.name,
      code: c.hex.toUpperCase(),
      share: `${Math.round(c.percentage)}%`,
    }));
  return { band, rows };
}

export function cardFilename(id: string): string {
  return `thread-swatch-${id.slice(0, 6).toLowerCase()}.png`;
}

function cssFont(variable: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return value || fallback;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  await image.decode();
  return image;
}

/** Draw `image` to fill the box, cropping the overflow evenly (like object-fit: cover). */
function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement) {
  const scale = Math.max(PHOTO.w / image.naturalWidth, PHOTO.h / image.naturalHeight);
  const sw = PHOTO.w / scale;
  const sh = PHOTO.h / scale;
  const sx = (image.naturalWidth - sw) / 2;
  const sy = (image.naturalHeight - sh) / 2;
  ctx.drawImage(image, sx, sy, sw, sh, PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h);
}

export async function renderSwatchCard(options: {
  imageUrl: string;
  wordmarkUrl: string;
  colours: CardColour[];
  caption: string;
}): Promise<Blob> {
  const display = cssFont("--font-fraunces", "Georgia, serif");
  const sans = cssFont("--font-inter", "system-ui, sans-serif");
  await Promise.all([document.fonts.load(`32px ${display}`), document.fonts.load(`22px ${sans}`)]);
  const [photo, wordmark] = await Promise.all([loadImage(options.imageUrl), loadImage(options.wordmarkUrl)]);

  const canvas = document.createElement("canvas");
  canvas.width = CARD.width;
  canvas.height = CARD.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't draw the card.");

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, CARD.width, CARD.height);
  drawCover(ctx, photo);

  const layout = cardLayout(options.colours);
  for (const segment of layout.band) {
    ctx.fillStyle = segment.hex;
    ctx.fillRect(segment.x, BAND.y, segment.width, BAND.h);
  }

  ctx.textBaseline = "middle";
  for (const row of layout.rows) {
    ctx.fillStyle = row.hex;
    ctx.fillRect(PHOTO.x, row.y - 18, 36, 36);
    ctx.strokeStyle = "rgba(32, 35, 33, 0.15)";
    ctx.strokeRect(PHOTO.x + 0.5, row.y - 17.5, 35, 35);
    ctx.fillStyle = INK;
    ctx.font = `32px ${display}`;
    ctx.textAlign = "left";
    ctx.fillText(row.name.replace(/^./, (c) => c.toUpperCase()), PHOTO.x + 60, row.y);
    ctx.fillStyle = MUTED;
    ctx.font = `22px ${sans}`;
    ctx.textAlign = "right";
    ctx.fillText(`${row.code}  ·  ${row.share}`, PHOTO.x + PHOTO.w, row.y);
  }

  ctx.strokeStyle = LINE;
  ctx.beginPath();
  ctx.moveTo(PHOTO.x, FOOTER_Y - 64);
  ctx.lineTo(PHOTO.x + PHOTO.w, FOOTER_Y - 64);
  ctx.stroke();
  const markHeight = 44;
  const markWidth = (wordmark.naturalWidth / wordmark.naturalHeight) * markHeight;
  ctx.drawImage(wordmark, PHOTO.x, FOOTER_Y - markHeight, markWidth, markHeight);
  ctx.fillStyle = MUTED;
  ctx.font = `22px ${sans}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(options.caption, PHOTO.x + PHOTO.w, FOOTER_Y - 8);

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The card could not be saved."))), "image/png"),
  );
}
