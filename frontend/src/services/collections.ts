import { apiFetch } from "@/lib/api-client";
import type { CollectionDetail, CollectionSummary } from "@/types/api";

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const path = (id: string) => `/collections/${encodeURIComponent(id)}`;

/** With itemId, each summary says whether that item is in the collection. */
export function listCollections(itemId?: string): Promise<CollectionSummary[]> {
  return apiFetch<CollectionSummary[]>(itemId ? `/collections?item_id=${encodeURIComponent(itemId)}` : "/collections");
}

export function getCollection(id: string): Promise<CollectionDetail> {
  return apiFetch<CollectionDetail>(path(id));
}

/** Rejects with code "conflict" (409) if you already have a collection with this name. */
export function createCollection(name: string, description?: string): Promise<CollectionDetail> {
  return apiFetch<CollectionDetail>("/collections", json("POST", { name, description: description || null }));
}

export function updateCollection(
  id: string,
  changes: { name?: string; description?: string | null },
): Promise<CollectionDetail> {
  return apiFetch<CollectionDetail>(path(id), json("PATCH", changes));
}

/** Deletes the collection only; its items stay in your library. */
export function deleteCollection(id: string): Promise<void> {
  return apiFetch<void>(path(id), { method: "DELETE" });
}

export function addToCollection(id: string, itemId: string, note?: string): Promise<CollectionDetail> {
  return apiFetch<CollectionDetail>(`${path(id)}/items`, json("POST", { item_id: itemId, note: note || null }));
}

export function removeFromCollection(id: string, itemId: string): Promise<CollectionDetail> {
  return apiFetch<CollectionDetail>(`${path(id)}/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
}

export function updateCollectionItem(
  id: string,
  itemId: string,
  changes: { note?: string | null; position?: number },
): Promise<CollectionDetail> {
  return apiFetch<CollectionDetail>(`${path(id)}/items/${encodeURIComponent(itemId)}`, json("PATCH", changes));
}
