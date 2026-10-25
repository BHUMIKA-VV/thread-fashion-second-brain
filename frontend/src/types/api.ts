// Mirrors backend/app/schemas. Keep in sync when the API changes.

export const ITEM_TYPES = ["outfit", "garment", "fabric", "accessory", "other"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export type ProcessingStatus =
  | "queued"
  | "processing"
  | "completed"
  | "partially_completed"
  | "failed";

export type PaletteColor = {
  hex: string;
  rgb: [number, number, number];
  name: string;
  family: string;
  /** Approximate share of the analysed pixels; all colours sum to 100. */
  percentage: number;
};

export type Harmony = "monochromatic" | "analogous" | "complementary" | "neutral" | "mixed";

export type Palette = {
  colors: PaletteColor[];
  /** Heuristic label, not a measurement. */
  harmony: Harmony | null;
  /** original = whole image; masked = plain backdrop excluded; cutout = background removed. */
  source: "original" | "masked" | "cutout";
  updated_at: string;
};

export type StageOutcome = "completed" | "failed";

export type Item = {
  id: string;
  type: ItemType;
  suggested_type: ItemType | null;
  notes: string | null;
  source_url: string | null;
  processing_status: ProcessingStatus;
  processing_error: string | null;
  width: number;
  height: number;
  mime_type: string;
  file_size: number;
  created_at: string;
  updated_at: string;
  stage_status: Partial<Record<"thumbnail" | "palette", StageOutcome>>;
  palette: Palette | null;
  /** Relative to the API root; prefix with API_BASE. */
  image_url: string;
  thumbnail_url: string;
  palette_card_url: string | null;
};

export type ItemList = {
  items: Item[];
  total: number;
  limit: number;
  offset: number;
};

export type ItemUpdate = {
  type?: ItemType;
  notes?: string | null;
  source_url?: string | null;
};

export type ApiErrorBody = {
  error: { code: string; message: string; details: unknown };
};

export type DatabaseHealth = {
  status: "ok" | "unavailable";
  server_version: string | null;
  pgvector_available: boolean | null;
  latency_ms: number | null;
  schema_revision: string | null;
  schema_head: string | null;
  schema_up_to_date: boolean | null;
};

export type HealthResponse = {
  status: "ok" | "degraded";
  app: string;
  version: string;
  environment: string;
  database: DatabaseHealth;
};
