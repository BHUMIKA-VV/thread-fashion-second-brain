import type { ItemType, TagCategory } from "@/types/api";

/** How each kind of piece reads in the upload panel and the playground. */
export const TYPE_LABELS: Record<ItemType, string> = {
  outfit: "Outfit",
  garment: "Garment",
  fabric: "Fabric swatch",
  accessory: "Accessory",
  other: "Other inspiration",
};

/** How each tag category reads beside its tags. */
export const CATEGORY_LABEL: Record<TagCategory, string> = {
  garment: "Garment",
  silhouette: "Silhouette",
  pattern: "Pattern",
  fabric: "Fabric (guess)",
  weave: "Weave",
  aesthetic: "Aesthetic",
  occasion: "Occasion",
  craft: "Craft",
};
