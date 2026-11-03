/**
 * Anonymous visit counts for public pages. Each page counts once per visit (a page load and
 * the client-side navigation after it): the API keeps only the day, the page, and the category
 * of where the visit came from. No cookie, storage or identifier is involved, and a browser
 * that asks not to be tracked (Global Privacy Control or Do Not Track) sends nothing.
 */

import type { MetricEvent } from "@/types/api";

export type CountedPage = MetricEvent;

const sent = new Set<CountedPage>();

type PrivacyNavigator = Navigator & { globalPrivacyControl?: boolean };

export function optedOut(nav: PrivacyNavigator = navigator): boolean {
  return nav.globalPrivacyControl === true || nav.doNotTrack === "1";
}

/** Only the host of the page the visit came from; never its path or query. */
export function referrerHost(referrer: string): string | null {
  try {
    return referrer ? new URL(referrer).host : null;
  } catch {
    return null;
  }
}

export function countView(event: CountedPage): void {
  if (sent.has(event) || optedOut()) return;
  sent.add(event);
  const body = {
    event,
    referrer: referrerHost(document.referrer),
    ref: new URLSearchParams(window.location.search).get("ref"),
  };
  // Fire and forget: counting must never slow a page down or show an error.
  void fetch("/api/metrics/view", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
    credentials: "omit",
  }).catch(() => undefined);
}

/** For tests: forget which pages this visit has counted. */
export function resetCountedViews(): void {
  sent.clear();
}
