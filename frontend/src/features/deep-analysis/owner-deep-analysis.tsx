"use client";

import { useSession } from "@/features/auth/use-session";

import { DeepAnalysisPanel } from "./deep-analysis-panel";

/** Deep analysis spends the owner's Anthropic credit, so only the owner sees the panel. */
export function OwnerDeepAnalysis({ itemId }: { itemId: string }) {
  const session = useSession();
  if (session.isPending) return null;
  if (session.data?.is_owner) return <DeepAnalysisPanel itemId={itemId} />;
  return (
    <section aria-labelledby="deep-analysis-title" className="border-t border-ink pt-5">
      <h2 id="deep-analysis-title" className="font-display text-xl">
        Deep analysis
      </h2>
      <p className="mt-3 text-sm text-ink-muted">
        A written reading of a piece by Claude, available to the owner of this Thread. Your palette,
        tags and kindred pieces are measured here for free.
      </p>
    </section>
  );
}
