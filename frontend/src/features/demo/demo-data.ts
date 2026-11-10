import dataset from "../../../public/demo/demo.json";

import type { ColorFamily, Harmony, ItemType } from "@/types/api";

/**
 * The public demo's dataset: public-domain museum pieces, computed once, offline, by
 * backend/scripts/build_demo.py with the app's own palette, tagging and similarity code.
 * It is static: the demo reads this file and images under /demo, never the API.
 */

export type DemoColour = { hex: string; name: string; family: ColorFamily; percentage: number };

export type DemoTag = {
  category: string;
  tag: string;
  /** "recorded": from the museum's catalogue; "ai": suggested by the image model. */
  source: "recorded" | "ai";
  is_guess: boolean;
};

export type DemoPiece = {
  id: string;
  title: string;
  type: ItemType;
  note: string | null;
  credit: string;
  licence: string;
  image: string;
  thumbnail: string;
  width: number;
  height: number;
  palette: DemoColour[];
  family: ColorFamily | null;
  tags: DemoTag[];
  similar_look: { id: string; similarity: number }[];
  similar_palette: { id: string; distance: number }[];
};

export type DemoCollection = { id: string; title: string; description: string | null; pieces: string[] };

export type OutfitColour = { hex: string; name: string; share: number; pieces: string[] };

export type DemoOutfit = {
  id: string;
  title: string;
  note: string | null;
  pieces: string[];
  colours: {
    dominant: OutfitColour[];
    shared: OutfitColour[];
    complementary: [OutfitColour, OutfitColour][];
    contrasting: [OutfitColour, OutfitColour][];
  };
};

/** A block of the demo's sample board, as build_demo.py publishes it. */
export type DemoBoardBlock =
  | { kind: "heading"; body: string }
  | { kind: "note"; body: string }
  | { kind: "piece"; piece: string; body: string | null }
  | { kind: "colour"; hex: string; name: string; family: string; body: string | null };

/** The sample board's colour story, calculated by the app's own board code at build time. */
export type DemoBoardStory = {
  measured: OutfitColour[];
  chosen: {
    /** Index of the colour block on the board. */
    block: number;
    hex: string;
    name: string;
    nearest: { hex: string; name: string; piece: string; distance: number } | null;
    on_pieces: boolean;
  }[];
  harmony: Harmony | null;
};

export type DemoBoard = {
  id: string;
  title: string;
  description: string | null;
  blocks: DemoBoardBlock[];
  colour_story: DemoBoardStory;
};

export type DemoDataset = {
  version: number;
  model: string | null;
  pieces: DemoPiece[];
  families: { family: ColorFamily; pieces: number }[];
  collections: DemoCollection[];
  outfits: DemoOutfit[];
  boards: DemoBoard[];
};

export const DEMO = dataset as unknown as DemoDataset;

/** Public URL of a dataset file (images and thumbnails live next to demo.json). */
export function demoAsset(path: string): string {
  return `/demo/${path}`;
}

const byId = new Map(DEMO.pieces.map((p) => [p.id, p]));

export function demoPiece(id: string): DemoPiece | undefined {
  return byId.get(id);
}

/** The pieces behind a list of ids, in order (ids the dataset doesn't hold are skipped). */
export function demoPieces(ids: string[]): DemoPiece[] {
  return ids.flatMap((id) => byId.get(id) ?? []);
}

export function demoCollection(id: string): DemoCollection | undefined {
  return DEMO.collections.find((c) => c.id === id);
}

export function demoOutfit(id: string): DemoOutfit | undefined {
  return DEMO.outfits.find((o) => o.id === id);
}

export function demoBoard(id: string): DemoBoard | undefined {
  return DEMO.boards.find((b) => b.id === id);
}

export type DemoFilters = { q: string; families: ColorFamily[]; type: ItemType | null };

export const NO_FILTERS: DemoFilters = { q: "", families: [], type: null };

function searchable(piece: DemoPiece): string {
  return [
    piece.title,
    piece.type,
    ...piece.tags.map((t) => t.tag),
    ...piece.palette.flatMap((c) => [c.name, c.family]),
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * Search and filter, like the showcase: every word of the query must appear in the title,
 * type, tags or colour names; a colour filter matches any colour in the palette (any of the
 * chosen families); the type filter is exact.
 */
export function filterDemo(pieces: DemoPiece[], filters: DemoFilters): DemoPiece[] {
  const words = filters.q.toLowerCase().split(/\s+/).filter(Boolean);
  return pieces.filter((piece) => {
    if (filters.type && piece.type !== filters.type) return false;
    if (filters.families.length && !piece.palette.some((c) => filters.families.includes(c.family))) return false;
    if (!words.length) return true;
    const text = searchable(piece);
    return words.every((word) => text.includes(word));
  });
}

/** Tags grouped by category, in vocabulary order of first appearance. */
export function tagsByCategory(tags: DemoTag[]): [string, DemoTag[]][] {
  const groups = new Map<string, DemoTag[]>();
  for (const tag of tags) groups.set(tag.category, [...(groups.get(tag.category) ?? []), tag]);
  return [...groups];
}

/** The credit line and the museum page it ends with ("… 2009.300.3337. https://…"). */
export function creditParts(credit: string): { text: string; url: string | null } {
  const match = credit.match(/^(.*?)\.?\s+(https:\/\/\S+)$/);
  return match ? { text: match[1], url: match[2] } : { text: credit, url: null };
}

export function pieceAlt(piece: DemoPiece): string {
  const colours = piece.palette.slice(0, 2).map((c) => c.name);
  return colours.length ? `${piece.title}; measured colours include ${colours.join(" and ")}` : piece.title;
}
