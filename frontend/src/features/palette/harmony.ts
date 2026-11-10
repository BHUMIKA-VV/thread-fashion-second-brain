import type { Harmony } from "@/types/api";

/**
 * Words for a measured harmony. A plain module, not a client one, so server-rendered pages (the
 * public demo's board) can read the table itself rather than a client reference to it.
 */
export const HARMONY_TEXT: Record<Harmony, string> = {
  monochromatic: "Monochromatic — shades of a single hue",
  analogous: "Analogous — neighbouring hues",
  complementary: "Complementary — opposite hues",
  neutral: "Neutral — no strong hues",
  mixed: "Mixed — several unrelated hues",
};
