import { apiFetch } from "@/lib/api-client";
import { filtersToSearch, type GalleryFilters } from "@/lib/gallery-filters";
import type {
  Item,
  ShowcaseCollection,
  ShowcaseCollectionSummary,
  ShowcaseItemDetail,
  ShowcaseList,
  ShowcaseSimilar,
  ShowcaseSummary,
} from "@/types/api";

// --- public, read-only ----------------------------------------------------------------------

export const getShowcaseSummary = () => apiFetch<ShowcaseSummary>("/showcase");

export function listShowcase(filters: GalleryFilters, limit = 48, offset = 0) {
  const search = filtersToSearch(filters);
  const page = `limit=${limit}&offset=${offset}`;
  return apiFetch<ShowcaseList>(`/showcase/items?${search ? `${search}&` : ""}${page}`);
}

export const getShowcaseItem = (id: string) => apiFetch<ShowcaseItemDetail>(`/showcase/items/${id}`);

export const getShowcaseSimilar = (id: string) => apiFetch<ShowcaseSimilar>(`/showcase/items/${id}/similar`);

export const listShowcaseCollections = () => apiFetch<ShowcaseCollectionSummary[]>("/showcase/collections");

export const getShowcaseCollection = (id: string) => apiFetch<ShowcaseCollection>(`/showcase/collections/${id}`);

// --- the owner's switches -------------------------------------------------------------------

const put = (body: unknown): RequestInit => ({
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const setItemPublic = (id: string, isPublic: boolean) =>
  apiFetch<Item>(`/items/${id}/showcase`, put({ public: isPublic }));

export const setCollectionPublic = (id: string, isPublic: boolean) =>
  apiFetch<{ public: boolean; changed: number }>(`/collections/${id}/showcase`, put({ public: isPublic }));

export const setAllPublic = (isPublic: boolean) =>
  apiFetch<{ public: boolean; changed: number }>("/items/showcase-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ public: isPublic }),
  });

