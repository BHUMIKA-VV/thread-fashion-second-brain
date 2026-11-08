import { pieceLabel } from "@/features/outfit-studio/names";
import { HARMONY_TEXT } from "@/features/palette/palette-view";
import { matchText } from "@/features/boards/colour-story";
import type { BoardDetail, CollectionDetail, Item } from "@/types/api";

/**
 * A presentation is a list of slides made from a board (in the board's order) or straight from
 * a collection. Everything on a slide comes from what the owner wrote or what Thread measured;
 * nothing is generated for the occasion.
 */
export type Slide =
  | { kind: "cover"; title: string; description: string | null; facts: string }
  | { kind: "section"; title: string }
  | { kind: "note"; body: string }
  | { kind: "piece"; item: Item; caption: string | null }
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
      return pieceLabel(slide.item);
    case "colour":
      return `${slide.name} ${slide.hex.toUpperCase()}`;
    case "story":
      return "Colour story";
    case "end":
      return "End of presentation";
  }
}

export function boardSlides(board: BoardDetail): Slide[] {
  const pieces = board.blocks.filter((b) => b.kind === "piece").length;
  const colours = board.blocks.filter((b) => b.kind === "colour").length;
  const facts = [count(pieces, "piece"), colours > 0 ? count(colours, "colour") : null].filter(Boolean).join(" · ");
  const { measured, chosen, harmony } = board.colour_story;
  const chosenByBlock = new Map(chosen.map((c) => [c.block_id, c]));
  const items = new Map(board.blocks.flatMap((b) => (b.item ? [[b.item.id, b.item] as const] : [])));
  const pieceName = (id: string) => {
    const item = items.get(id);
    return item ? pieceLabel(item) : "a piece";
  };

  const slides: Slide[] = [{ kind: "cover", title: board.name, description: board.description, facts }];
  for (const block of board.blocks) {
    if (block.kind === "heading" && block.body) slides.push({ kind: "section", title: block.body });
    else if (block.kind === "note" && block.body) slides.push({ kind: "note", body: block.body });
    else if (block.kind === "piece" && block.item) slides.push({ kind: "piece", item: block.item, caption: block.body });
    else if (block.kind === "colour" && block.colour) {
      const story = chosenByBlock.get(block.id);
      slides.push({
        kind: "colour",
        hex: block.colour.hex,
        name: block.colour.name,
        caption: block.body,
        match: story ? matchText(story, pieceName) : null,
      });
    }
  }
  if (harmony || measured.dominant.length > 0 || chosen.length > 0) {
    slides.push({
      kind: "story",
      harmony: harmony ? HARMONY_TEXT[harmony] : null,
      measured: measured.dominant.map((c) => ({ hex: c.hex, name: c.name, share: c.share })),
      chosen: chosen.map((c) => ({ hex: c.hex, name: c.name, text: matchText(c, pieceName) })),
    });
  }
  slides.push({ kind: "end", title: board.name });
  return slides;
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
  for (const entry of collection.items) slides.push({ kind: "piece", item: entry.item, caption: entry.note });
  slides.push({ kind: "end", title: collection.name });
  return slides;
}
