import type { ApiErrorBody } from "@/types/api";

/** All browser requests go through the Next.js /api proxy (see next.config.ts). */
export const API_BASE = "/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as ApiErrorBody).error?.message === "string"
  );
}

/** Turns a failed response into an ApiError, using the backend's structured error when present. */
export async function toApiError(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => null);
  if (isApiErrorBody(body)) {
    return new ApiError(response.status, body.error.code, body.error.message, body.error.details);
  }
  // The proxy returns 500/502 with no JSON when the backend is not running.
  return new ApiError(
    response.status,
    "unreachable",
    response.status >= 500 ? "The Thread API is not reachable." : "Unexpected response.",
  );
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError(0, "network_error", "Network error. Check your connection.");
  }
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}
