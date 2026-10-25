import { API_BASE, apiErrorFromText, apiFetch } from "@/lib/api-client";
import type { Item, ItemList, ItemType, ItemUpdate, SimilarResponse } from "@/types/api";

export type ListItemsParams = { type?: ItemType; limit?: number; offset?: number };

export function listItems({ type, limit = 48, offset = 0 }: ListItemsParams = {}): Promise<ItemList> {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (type) query.set("type", type);
  return apiFetch<ItemList>(`/items?${query}`);
}

export function getItem(id: string): Promise<Item> {
  return apiFetch<Item>(`/items/${encodeURIComponent(id)}`);
}

export function updateItem(id: string, changes: ItemUpdate): Promise<Item> {
  return apiFetch<Item>(`/items/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
}

/** (Re-)extract the palette from the stored image. Rejects with code "palette_failed" on failure. */
export function extractPalette(id: string, colors?: number): Promise<Item> {
  const query = colors ? `?colors=${colors}` : "";
  return apiFetch<Item>(`/items/${encodeURIComponent(id)}/palette${query}`, { method: "POST" });
}

/** Owner-scoped visual neighbours. Rejects with code "model_unavailable" (503) or "embedding_failed" (422). */
export function getSimilar(id: string, limit = 12): Promise<SimilarResponse> {
  return apiFetch<SimilarResponse>(`/items/${encodeURIComponent(id)}/similar?limit=${limit}`);
}

/** (Re-)index this item's image embedding. */
export function indexItem(id: string): Promise<Item> {
  return apiFetch<Item>(`/items/${encodeURIComponent(id)}/embedding`, { method: "POST" });
}

export function deleteItem(id: string): Promise<void> {
  return apiFetch<void>(`/items/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export type UploadOptions = {
  type: ItemType;
  /** 0–1 fraction of bytes sent. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

/**
 * POST /items with real upload progress. fetch() cannot report upload progress,
 * so this uses XMLHttpRequest. Rejects with ApiError on any failure.
 */
export function uploadItem(file: File, { type, onProgress, signal }: UploadOptions): Promise<Item> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/items`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status === 201) {
        try {
          resolve(JSON.parse(xhr.responseText) as Item);
        } catch {
          reject(apiErrorFromText(xhr.status, ""));
        }
      } else {
        reject(apiErrorFromText(xhr.status, xhr.responseText));
      }
    };
    xhr.onerror = () => reject(apiErrorFromText(0, ""));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });

    const form = new FormData();
    form.append("file", file);
    form.append("type", type);
    xhr.send(form);
  });
}
