import { matchText } from "@/features/boards/colour-story";
import { creditParts, demoAsset, demoPiece, pieceAlt, type DemoBoard, type DemoPiece } from "@/features/demo/demo-data";
import { pieceLabel } from "@/features/outfit-studio/names";
import { HARMONY_TEXT } from "@/features/palette/harmony";
import { apiUrl } from "@/lib/api-client";
import type { BoardDetail, ChosenColour, CollectionDetail, Harmony, Item } from "@/types/api";

/**
 * A presentation is a list of slides made from a board (in the board's order), straight from a
 * collection, or from the public demo's sample board. Everything on a slide comes from what the
 * owner wrote, what a museum recorded, or what Thread measured; nothing is generated for the
 * occasion.
 */

/** A piece as a slide shows it, whether it comes from your archive or from the demo. */
export type SlidePiece = {
  title: string;
  image: string;
  alt: string;
  /** Your note, or the demo piece's note with its museum record number. */
  note: string | null;
  /** The museum credit and licence of a demo piece; always shown. */
  credit: string | null;
  source: { label: string; url: string } | null;
  colours: { hex: string; name: string; percentage: number }[];
  /** Internal detail, shown only when the presenter asks: [label, value]. */
  details: [string, string][];
};

export type Slide =
  | { kind: "cover"; title: string; description: string | null; facts: string }
  | { kind: "section"; title: string }
  | { kind: "note"; body: string }
  | { kind: "piece"; piece: SlidePiece; caption: string | null }
  | { kind: "colour"; hex: string; name: string; caption: string | null; match: string | null }
  | {
      kind: "story";
      harmony: string | null;
      measured: { hex: string; name: string; share: number }[];
      chosen: { hex: string; name: string; text: string }[];
    }
  | { kind: "end"; title: string };

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A short name for a slide, for its label and the announcement when it changes. */
export function slideTitle(slide: Slide): string {
  switch (slide.kind) {
    case "cover":
      return slide.title;
    case "section":
      return slide.title;
    case "note":
      return slide.body.length > 60 ? `Note: ${slide.body.slice(0, 60).trimEnd()}…` : `Note: ${slide.body}`;
    case "piece":
      return slide.piece.title;
    case "colour":
      return `${slide.name} ${slide.hex.toUpperCase()}`;
    case "story":
      return "Colour story";
    case "end":
      return "End of presentation";
  }
}

export function itemPiece(item: Item): SlidePiece {
  const colours = item.palette?.colors ?? [];
  const details: [string, string][] = [
    ["Type", item.type],
    ["Record", item.id.slice(0, 8).toUpperCase()],
  ];
  if (item.suggested_type && item.suggested_type !== item.type) {
    details.push(["Thread suggested", `${item.suggested_type} (an AI guess, not used)`]);
  }
  details.push(["Status", item.processing_status], ["Photograph", `${item.width} × ${item.height} px`]);
  if (colours.length > 0) details.push(["Colour shares", colours.map((c) => `${c.name} ${Math.round(c.percentage)}%`).join(", ")]);
  return {
    title: pieceLabel(item),
    image: apiUrl(item.image_url),
    alt: pieceLabel(item),
    note: item.notes?.trim() || null,
    credit: null,
    source: item.source_url ? { label: "Source", url: item.source_url } : null,
    colours,
    details,
  };
}

export function demoSlidePiece(piece: DemoPiece): SlidePiece {
  const credit = creditParts(piece.credit);
  const ai = piece.tags.filter((t) => t.source === "ai");
  const recorded = piece.tags.filter((t) => t.source === "recorded");
  const details: [string, string][] = [["Type", piece.type]];
  if (recorded.length > 0) details.push(["Recorded tags", recorded.map((t) => t.tag).join(", ")]);
  if (ai.length > 0) {
    details.push(["AI suggestions", ai.map((t) => (t.is_guess ? `${t.tag} (guess)` : t.tag)).join(", ")]);
  }
  details.push(["Colour shares", piece.palette.map((c) => `${c.name} ${Math.round(c.percentage)}%`).join(", ")]);
  return {
    title: piece.title,
    image: demoAsset(piece.image),
    alt: pieceAlt(piece),
    note: piece.note,
    credit: `${credit.text}. ${piece.licence}.`,
    source: credit.url ? { label: "Museum record", url: credit.url } : null,
    colours: piece.palette,
    details,
  };
}

/** The slides between the cover and the end, from a board's blocks in order. */
type Block =
  | { kind: "heading"; body: string }
  | { kind: "note"; body: string }
  | { kind: "piece"; piece: SlidePiece; caption: string | null }
  | { kind: "colour"; hex: string; name: string; caption: string | null; match: string | null };

function slidesFor(
  cover: Extract<Slide, { kind: "cover" }>,
  blocks: Block[],
  story: {
    harmony: Harmony | null;
    measured: { hex: string; name: string; share: number }[];
    chosen: { hex: string; name: string; text: string }[];
  },
): Slide[] {
  const slides: Slide[] = [cover];
  for (const block of blocks) {
    if (block.kind === "heading") slides.push({ kind: "section", title: block.body });
    else if (block.kind === "note") slides.push({ kind: "note", body: block.body });
    else slides.push(block);
  }
  if (story.harmony || story.measured.length > 0 || story.chosen.length > 0) {
    slides.push({
      kind: "story",
      harmony: story.harmony ? HARMONY_TEXT[story.harmony] : null,
      measured: story.measured,
      chosen: story.chosen,
    });
  }
  slides.push({ kind: "end", title: cover.title });
  return slides;
}

function facts(pieces: number, colours: number): string {
  return [count(pieces, "piece"), colours > 0 ? count(colours, "colour") : null].filter(Boolean).join(" · ");
}

export function boardSlides(board: BoardDetail): Slide[] {
  const { measured, chosen, harmony } = board.colour_story;
  const chosenByBlock = new Map(chosen.map((c) => [c.block_id, c]));
  const items = new Map(board.blocks.flatMap((b) => (b.item ? [[b.item.id, b.item] as const] : [])));
  const pieceName = (id: string) => {
    const item = items.get(id);
    return item ? pieceLabel(item) : "a piece";
  };

  const blocks: Block[] = board.blocks.flatMap((block): Block[] => {
    if (block.kind === "heading" && block.body) return [{ kind: "heading", body: block.body }];
    if (block.kind === "note" && block.body) return [{ kind: "note", body: block.body }];
    if (block.kind === "piece" && block.item) return [{ kind: "piece", piece: itemPiece(block.item), caption: block.body }];
    if (block.kind === "colour" && block.colour) {
      const story = chosenByBlock.get(block.id);
      return [
        {
          kind: "colour",
          hex: block.colour.hex,
          name: block.colour.name,
          caption: block.body,
          match: story ? matchText(story, pieceName) : null,
        },
      ];
    }
    return [];
  });
  return slidesFor(
    {
      kind: "cover",
      title: board.name,
      description: board.description,
      facts: facts(board.blocks.filter((b) => b.kind === "piece").length, board.blocks.filter((b) => b.kind === "colour").length),
    },
    blocks,
    {
      harmony,
      measured: measured.dominant.map((c) => ({ hex: c.hex, name: c.name, share: c.share })),
      chosen: chosen.map((c) => ({ hex: c.hex, name: c.name, text: matchText(c, pieceName) })),
    },
  );
}

/** A demo board's chosen colour in the app's shape, so it is described by the same words. */
export function demoChosen(board: DemoBoard): ChosenColour[] {
  return board.colour_story.chosen.map((c) => ({
    block_id: String(c.block),
    hex: c.hex,
    name: c.name,
    family: "",
    nearest: c.nearest && { hex: c.nearest.hex, name: c.nearest.name, item_id: c.nearest.piece, distance: c.nearest.distance },
    on_pieces: c.on_pieces,
  }));
}

export const demoPieceName = (id: string) => demoPiece(id)?.title ?? "a piece";

export function demoBoardSlides(board: DemoBoard): Slide[] {
  const chosen = demoChosen(board);
  const byBlock = new Map(chosen.map((c) => [Number(c.block_id), c]));
  const blocks: Block[] = board.blocks.flatMap((block, index): Block[] => {
    if (block.kind === "heading" && block.body) return [{ kind: "heading", body: block.body }];
    if (block.kind === "note" && block.body) return [{ kind: "note", body: block.body }];
    if (block.kind === "piece") {
      const piece = demoPiece(block.piece);
      return piece ? [{ kind: "piece", piece: demoSlidePiece(piece), caption: block.body }] : [];
    }
    if (block.kind === "colour") {
      const story = byBlock.get(index);
      return [{ kind: "colour", hex: block.hex, name: block.name, caption: block.body, match: story ? matchText(story, demoPieceName) : null }];
    }
    return [];
  });
  return slidesFor(
    {
      kind: "cover",
      title: board.title,
      description: board.description,
      facts: facts(board.blocks.filter((b) => b.kind === "piece").length, board.blocks.filter((b) => b.kind === "colour").length),
    },
    blocks,
    {
      harmony: board.colour_story.harmony,
      measured: board.colour_story.measured.map((c) => ({ hex: c.hex, name: c.name, share: c.share })),
      chosen: chosen.map((c) => ({ hex: c.hex, name: c.name, text: matchText(c, demoPieceName) })),
    },
  );
}

export function collectionSlides(collection: CollectionDetail): Slide[] {
  const slides: Slide[] = [
    {
      kind: "cover",
      title: collection.name,
      description: collection.description,
      facts: count(collection.items.length, "piece"),
    },
  ];
  for (const entry of collection.items) slides.push({ kind: "piece", piece: itemPiece(entry.item), caption: entry.note });
  slides.push({ kind: "end", title: collection.name });
  return slides;
}
