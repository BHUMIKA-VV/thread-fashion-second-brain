import type { ColorFamily } from "@/types/api";

/** Representative swatch colours for the colour families (filters, Colour Lab). These are
 * labels for a family, not measured colours; measured colours always come from a palette. */
export const FAMILY_SWATCH: Record<ColorFamily, string> = {
  red: "#c0392b",
  orange: "#e67e22",
  yellow: "#f1c40f",
  green: "#4a7c3a",
  teal: "#16a085",
  blue: "#2c5aa0",
  purple: "#7d3c98",
  pink: "#e75480",
  brown: "#7b4a2a",
  beige: "#d9c6a5",
  white: "#ffffff",
  grey: "#8a8a8a",
  black: "#1c1a1a",
};
