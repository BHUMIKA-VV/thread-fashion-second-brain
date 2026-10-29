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

/** pending = waiting for the image model to load; unavailable = model not installed/off. */
export type StageOutcome = "completed" | "failed" | "pending" | "unavailable";

export type SimilarMode = "visual" | "palette" | "fabric";

export type SimilarItem = {
  item: Item;
  /** Cosine similarity of image embeddings: good for ranking, not a probability. Null in palette mode. */
  similarity: number | null;
  /** Palette mode: share-weighted CIEDE2000 distance (lower = closer colours). */
  palette_distance: number | null;
  reasons: string[];
};

export type SimilarResponse = {
  item_id: string;
  mode: SimilarMode;
  model: string;
  results: SimilarItem[];
  compared: number;
  not_indexed: number;
  notice: string | null;
};

export const TAG_CATEGORIES = [
  "garment",
  "silhouette",
  "pattern",
  "fabric",
  "aesthetic",
  "occasion",
  "craft",
] as const;
export type TagCategory = (typeof TAG_CATEGORIES)[number];

export type ItemTag = {
  category: TagCategory;
  tag: string;
  source: "ai" | "user";
  /** AI model score: softmax within the category. Relative and uncalibrated, not a probability. */
  score: number | null;
  custom: boolean;
  outdated: boolean;
  is_guess: boolean;
};

export type ItemTags = {
  item_id: string;
  status: "completed" | "pending" | "unavailable" | "failed";
  version: string | null;
  suggested_type: ItemType | null;
  tags: ItemTag[];
  removed: ItemTag[];
};

export type TagEdit = { category: TagCategory; tag: string };

export type LabelScore = { tag: string; score: number; none: boolean; passes: boolean };

export type TagScores = {
  item_id: string;
  version: string;
  note: string;
  categories: {
    category: TagCategory;
    is_guess: boolean;
    min_score: number;
    min_margin: number;
    max_tags: number;
    labels: LabelScore[];
  }[];
};

export type Vocabulary = {
  version: string;
  categories: { category: TagCategory; is_guess: boolean; max_tags: number; tags: string[] }[];
};

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
  stage_status: Partial<Record<"thumbnail" | "palette" | "embedding" | "tags", StageOutcome>>;
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
  /** With a text query: why each item on this page matched, keyed by item id. */
  reasons: Record<string, string[]>;
};

export const COLOR_FAMILIES = [
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
  "brown",
  "beige",
  "white",
  "grey",
  "black",
] as const;
export type ColorFamily = (typeof COLOR_FAMILIES)[number];

export type SortOrder = "newest" | "oldest" | "relevance";

export type LibrarySummary = {
  total: number;
  by_type: Partial<Record<ItemType, number>>;
  by_status: Partial<Record<ProcessingStatus, number>>;
  color_families: { family: ColorFamily; items: number }[];
  tags: { category: string; tag: string; items: number }[];
  collections: number;
  recent: Item[];
};

export type CollectionSummary = {
  id: string;
  name: string;
  description: string | null;
  item_count: number;
  /** API-relative thumbnail URLs of the first four items. */
  cover_thumbnails: string[];
  contains_item: boolean | null;
  created_at: string;
  updated_at: string;
};

export type CollectionEntry = { item: Item; note: string | null; position: number; added_at: string };

export type CollectionDetail = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  items: CollectionEntry[];
};

export type ItemUpdate = {
  type?: ItemType;
  notes?: string | null;
  source_url?: string | null;
};

export type ApiErrorBody = {
  error: { code: string; message: string; details: unknown };
};

export type EmbeddingModelHealth = {
  state: "disabled" | "not_loaded" | "loading" | "ready" | "unavailable" | "failed";
  model: string;
  dimension: number;
  weights_present: boolean;
  load_seconds: number | null;
  detail: string | null;
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
  embedding_model: EmbeddingModelHealth;
};

// --- Deep analysis (Milestone 7b) ---------------------------------------------------------

export type Confidence = "low" | "medium" | "high";

export type DeepAnalysisResult = {
  summary: string;
  is_fashion_image: boolean;
  garment: string | null;
  silhouette: string | null;
  pattern: string | null;
  fabric: { guess: string; confidence: Confidence; reasoning: string } | null;
  crafts: { name: string; confidence: Confidence; evidence: string }[];
  styling_ideas: string[];
  occasions: string[];
  caveats: string[];
};

export type DeepAnalysisStatus = {
  available: boolean;
  reason: "not_configured" | "disabled_in_production" | null;
  provider: "claude" | "fake" | null;
  model: string | null;
  effort: string | null;
  daily_limit: number;
  runs_today: number;
  sent: string[];
  not_sent: string[];
};

export type DeepAnalysis = {
  item_id: string;
  status: "not_run" | "running" | "completed" | "failed";
  requested_model: string | null;
  started_at: string | null;
  finished_at: string | null;
  error: { code: string; message: string; retry_after_seconds: number | null } | null;
  result: DeepAnalysisResult | null;
  result_model: string | null;
  result_at: string | null;
  prompt_version: string | null;
  usage: { input_tokens: number | null; output_tokens: number | null } | null;
};

/** The signed-in account (GET /auth/session, /auth/me). */
export type Me = {
  id: string;
  display_name: string;
  email: string | null;
  email_verified: boolean;
  is_owner: boolean;
  has_password: boolean;
};

/** An account as the owner sees it (GET /admin/accounts). */
export type AccountRead = {
  id: string;
  display_name: string;
  email: string | null;
  created_at: string;
  email_verified: boolean;
  disabled: boolean;
  is_owner: boolean;
  items: number;
};
