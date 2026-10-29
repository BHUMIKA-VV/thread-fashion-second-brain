import { apiFetch } from "@/lib/api-client";
import type { DeepAnalysis, DeepAnalysisStatus } from "@/types/api";

const path = (itemId: string) => `/items/${encodeURIComponent(itemId)}`;

/** Whether deep analysis is configured, today's usage, and what a run sends. */
export function getDeepAnalysisStatus(): Promise<DeepAnalysisStatus> {
  return apiFetch<DeepAnalysisStatus>("/deep-analysis/status");
}

export function getDeepAnalysis(itemId: string): Promise<DeepAnalysis> {
  return apiFetch<DeepAnalysis>(`${path(itemId)}/deep-analysis`);
}

/** Only call after the user confirmed. Rejects with already_running (409), busy or
 * daily_limit_reached (429), or deep_analysis_unavailable (503). */
export function startDeepAnalysis(itemId: string): Promise<DeepAnalysis> {
  return apiFetch<DeepAnalysis>(`${path(itemId)}/deep-analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: true }),
  });
}
