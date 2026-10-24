import { API_BASE, ApiError, toApiError } from "@/lib/api-client";
import type { HealthResponse } from "@/types/api";

function isHealthResponse(value: unknown): value is HealthResponse {
  return typeof value === "object" && value !== null && "database" in value && "status" in value;
}

/**
 * GET /health. A 503 still carries a useful body (which dependency is down),
 * so it is returned as data rather than thrown.
 */
export async function getHealth(): Promise<HealthResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/health`, { cache: "no-store" });
  } catch {
    throw new ApiError(0, "network_error", "Network error. Check your connection.");
  }
  if (response.ok || response.status === 503) {
    const body: unknown = await response.clone().json().catch(() => null);
    if (isHealthResponse(body)) return body;
  }
  throw await toApiError(response);
}
