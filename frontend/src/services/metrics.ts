import { apiFetch } from "@/lib/api-client";
import type { MetricEvent, MetricsSummary } from "@/types/api";

export const getMetrics = (days: number) =>
  apiFetch<MetricsSummary>(`/admin/metrics?days=${days}`, { cache: "no-store" });

/** The counted pages, in the order a visitor usually meets them. */
export const EVENT_LABELS: Record<MetricEvent, string> = {
  landing_view: "Landing page",
  demo_view: "Demo",
  how_it_works_view: "How it works",
  pilot_view: "Studio pilot",
  signup_view: "Sign-up page",
};

const SOURCE_LABELS: Record<string, string> = {
  direct: "Direct or unknown",
  internal: "From another Thread page",
  other: "Other sites",
  search: "Search engines",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  pinterest: "Pinterest",
  x: "X",
  youtube: "YouTube",
  reddit: "Reddit",
};

export function sourceLabel(source: string): string {
  if (source.startsWith("ref:")) return `Link tagged “${source.slice(4)}”`;
  return SOURCE_LABELS[source] ?? source;
}
