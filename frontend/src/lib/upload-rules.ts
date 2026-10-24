/**
 * Quick client-side checks for instant feedback. The server re-validates everything from the
 * actual bytes, so these are a convenience, not a security boundary.
 * Keep MAX_UPLOAD_BYTES in sync with THREAD_MAX_UPLOAD_BYTES (default 15 MB).
 */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const ACCEPT_ATTRIBUTE = ACCEPTED_TYPES.join(",");

export function precheckFile(file: Pick<File, "type" | "size">): string | null {
  // Some browsers report an empty type; let the server decide in that case.
  if (file.type && !(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return "Only JPEG, PNG and WebP images are supported.";
  }
  if (file.size === 0) return "The file is empty.";
  if (file.size > MAX_UPLOAD_BYTES) return "The file is larger than 15 MB.";
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
