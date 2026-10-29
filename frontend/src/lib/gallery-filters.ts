import { COLOR_FAMILIES, ITEM_TYPES, type ColorFamily, type ItemType, type SortOrder } from "@/types/api";

/** Gallery filters, kept in the URL so a filtered view survives reloads and the back button. */
export type GalleryFilters = {
  q: string;
  tags: string[]; // "category:tag" or "tag"
  colors: ColorFamily[];
  type?: ItemType;
  sort: SortOrder;
};

export const EMPTY_FILTERS: GalleryFilters = { q: "", tags: [], colors: [], sort: "newest" };

const SORTS: readonly SortOrder[] = ["newest", "oldest", "relevance"];

/** Read filters from URL search params, ignoring anything invalid (hand-edited URLs). */
export function parseFilters(params: Pick<URLSearchParams, "get" | "getAll">): GalleryFilters {
  const type = params.get("type");
  const sort = params.get("sort");
  return {
    q: (params.get("q") ?? "").slice(0, 100),
    tags: unique(params.getAll("tag").map((t) => t.trim()).filter(Boolean)).slice(0, 10),
    colors: unique(params.getAll("color")).filter((c): c is ColorFamily =>
      (COLOR_FAMILIES as readonly string[]).includes(c),
    ),
    type: type && (ITEM_TYPES as readonly string[]).includes(type) ? (type as ItemType) : undefined,
    sort: sort && (SORTS as readonly string[]).includes(sort) ? (sort as SortOrder) : "newest",
  };
}

/** The canonical URL query for a set of filters (empty values omitted). */
export function filtersToSearch(filters: GalleryFilters): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  filters.tags.forEach((tag) => params.append("tag", tag));
  filters.colors.forEach((color) => params.append("color", color));
  if (filters.type) params.set("type", filters.type);
  if (filters.sort !== "newest") params.set("sort", filters.sort);
  return params.toString();
}

export function hasActiveFilters(filters: GalleryFilters): boolean {
  return Boolean(filters.q.trim() || filters.tags.length || filters.colors.length || filters.type);
}

/** "craft:ikat" -> "ikat (craft)"; "ikat" -> "ikat". */
export function tagLabel(tag: string): string {
  const [category, name] = tag.includes(":") ? tag.split(":", 2) : [null, tag];
  return category ? `${name} (${category})` : name;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
