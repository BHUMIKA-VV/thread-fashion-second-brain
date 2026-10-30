import type { Item, OutfitLayout, OutfitPieceRole, OutfitSeason } from "@/types/api";

export const SEASON_NAMES: Record<OutfitSeason, string> = {
  spring: "Spring",
  summer: "Summer",
  monsoon: "Monsoon",
  autumn: "Autumn",
  winter: "Winter",
  all_season: "All seasons",
};

export const ROLE_NAMES: Record<OutfitPieceRole, string> = {
  piece: "Piece",
  accessory: "Accessory",
  inspiration: "Inspiration",
};

export const LAYOUT_NAMES: Record<OutfitLayout, string> = {
  feature: "Feature",
  grid: "Grid",
  column: "Column",
};

/** A short, real description of a piece: your own note if there is one, otherwise its type. */
export function pieceLabel(item: Item): string {
  const note = item.notes?.trim();
  if (note) return note.length > 60 ? `${note.slice(0, 60).trimEnd()}…` : note;
  return `${item.type} ${item.id.slice(0, 6).toUpperCase()}`;
}
