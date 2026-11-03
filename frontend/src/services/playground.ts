import { apiFetch } from "@/lib/api-client";
import type { ItemType, PlaygroundResult } from "@/types/api";

/** Mirrors backend/app/services/playground.py. */
export const PLAYGROUND_MAX_BYTES = 8 * 1024 * 1024;
export const PLAYGROUND_FORMATS = ["image/jpeg", "image/png", "image/webp"];

/** Send one photo, as the request body, to be analysed in memory. Nothing is stored. */
export const analysePhoto = (file: Blob, type: ItemType | null) =>
  apiFetch<PlaygroundResult>(`/playground/analyse${type ? `?type=${type}` : ""}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
    credentials: "omit",
  });
