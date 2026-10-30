import { apiFetch } from "@/lib/api-client";
import type { CollectionDetail, OutfitDetail, OutfitList, OutfitPieceRole, OutfitUpdate } from "@/types/api";

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const path = (id: string) => `/outfits/${encodeURIComponent(id)}`;

export function listOutfits(params: { q?: string; limit?: number; offset?: number } = {}): Promise<OutfitList> {
  const query = new URLSearchParams({ limit: String(params.limit ?? 24), offset: String(params.offset ?? 0) });
  if (params.q) query.set("q", params.q);
  return apiFetch<OutfitList>(`/outfits?${query}`);
}

export function getOutfit(id: string): Promise<OutfitDetail> {
  return apiFetch<OutfitDetail>(path(id));
}

/** Rejects with code "outfit_limit" (409) when the account has no room for another. */
export function createOutfit(name: string): Promise<OutfitDetail> {
  return apiFetch<OutfitDetail>("/outfits", json("POST", { name }));
}

export function updateOutfit(id: string, changes: OutfitUpdate): Promise<OutfitDetail> {
  return apiFetch<OutfitDetail>(path(id), json("PATCH", changes));
}

/** Deletes the outfit only; its pieces stay in your library. */
export function deleteOutfit(id: string): Promise<void> {
  return apiFetch<void>(path(id), { method: "DELETE" });
}

export function duplicateOutfit(id: string): Promise<OutfitDetail> {
  return apiFetch<OutfitDetail>(`${path(id)}/duplicate`, { method: "POST" });
}

/** The list becomes the outfit, all at once: on any error the outfit stays as it was. */
export function replaceOutfitItems(
  id: string,
  items: { item_id: string; role: OutfitPieceRole }[],
): Promise<OutfitDetail> {
  return apiFetch<OutfitDetail>(`${path(id)}/items`, json("PUT", { items }));
}

export function addOutfitToCollection(collectionId: string, outfitId: string): Promise<CollectionDetail> {
  return apiFetch<CollectionDetail>(
    `/collections/${encodeURIComponent(collectionId)}/outfits`,
    json("POST", { outfit_id: outfitId }),
  );
}

export function removeOutfitFromCollection(collectionId: string, outfitId: string): Promise<CollectionDetail> {
  return apiFetch<CollectionDetail>(
    `/collections/${encodeURIComponent(collectionId)}/outfits/${encodeURIComponent(outfitId)}`,
    { method: "DELETE" },
  );
}
