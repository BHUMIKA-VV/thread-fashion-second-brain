"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { PaletteStrip } from "@/features/palette/palette-strip";
import { ApiError, apiUrl } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { getSimilar, indexItem } from "@/services/items";
import type { SimilarItem, SimilarMode } from "@/types/api";

const MODES: { mode: SimilarMode; label: string; description: string }[] = [
  {
    mode: "visual",
    label: "Visually similar",
    description: "Ranked by visual similarity of the whole image.",
  },
  {
    mode: "palette",
    label: "Same palette, different silhouette",
    description:
      "Ranked by colour distance; pieces with the same silhouette or garment tag are left out when both are tagged.",
  },
  {
    mode: "fabric",
    label: "Same fabric, different colour",
    description:
      "Visually close pieces that share a fabric, pattern or craft tag, different dominant colours first.",
  },
];

export function SimilarPieces({ itemId }: { itemId: string }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<SimilarMode>("visual");
  const query = useQuery({
    queryKey: ["items", "similar", itemId, mode],
    queryFn: () => getSimilar(itemId, mode),
    retry: false,
    staleTime: 30_000,
    // While the API reports the image model as loading, ask again every few seconds.
    refetchInterval: (q) => (isModelLoading(q.state.error) ? MODEL_LOADING_RETRY_MS : false),
  });
  const modelLoading = isModelLoading(query.error);
  const reindex = useMutation({
    mutationFn: () => indexItem(itemId),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["items"] }),
  });
  const current = MODES.find((m) => m.mode === mode)!;
  const tabsId = useId();

  return (
    <section aria-labelledby="similar-title" className="mt-16">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="similar-title" className="font-display text-2xl">
            Similar pieces
          </h2>
          <p className="mt-1 text-sm text-ink-muted">From your own library. {current.description}</p>
        </div>
      </div>

      <div role="tablist" aria-label="Similarity mode" className="mt-4 flex flex-wrap gap-2">
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            role="tab"
            id={`${tabsId}-${m.mode}`}
            aria-selected={mode === m.mode}
            aria-controls={`${tabsId}-panel`}
            onClick={() => setMode(m.mode)}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm transition-colors",
              mode === m.mode
                ? "border-ink bg-ink text-paper"
                : "border-line bg-paper-raised text-ink-muted hover:border-ink/40 hover:text-ink",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div
        id={`${tabsId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabsId}-${mode}`}
        className="mt-6"
        aria-live="polite"
        aria-busy={query.isPending}
      >
        {query.isPending ? (
          <Loading />
        ) : modelLoading ? (
          <Loading message="Loading the image model… This can take up to a minute after the app starts; results appear automatically." />
        ) : query.isError ? (
          <SimilarError
            error={query.error}
            retrying={query.isFetching || reindex.isPending}
            onRetry={() => void query.refetch()}
            onReindex={() => reindex.mutate()}
          />
        ) : query.data.results.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-ink/20 px-6 py-10 text-center text-sm text-ink-muted">
            {query.data.notice ??
              (query.data.not_indexed > 0
                ? "None of your other pieces could be compared yet."
                : "Nothing to compare with yet — save more pieces to see matches.")}
          </p>
        ) : (
          <>
            {query.data.notice && (
              <p className="mb-4 rounded-xl bg-ink/[0.04] px-4 py-3 text-sm text-ink-muted">{query.data.notice}</p>
            )}
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {query.data.results.map((result, index) => (
                <SimilarCard key={result.item.id} result={result} index={index} />
              ))}
            </ul>
            <p className="mt-4 text-xs text-ink-muted">
              Compared with {query.data.compared} of your pieces
              {query.data.not_indexed > 0 ? ` (${query.data.not_indexed} could not be compared)` : ""}.{" "}
              {mode === "palette"
                ? "Colour distance is CIEDE2000 between the two palettes: lower means closer colours."
                : "Scores are cosine similarity of image embeddings — useful for ranking, not a percentage match."}{" "}
              Reasons describe the tags and colours used, which are model guesses or your edits.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

export const MODEL_LOADING_RETRY_MS = 3_000;

function isModelLoading(error: unknown): boolean {
  return error instanceof ApiError && error.code === "model_loading";
}

function Loading({ message = "Comparing images…" }: { message?: string }) {
  return (
    <div>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" aria-label="Loading similar pieces">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i} className="aspect-[3/4] animate-pulse rounded-xl bg-ink/[0.06]" />
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-muted">{message}</p>
    </div>
  );
}

function SimilarError({
  error,
  retrying,
  onRetry,
  onReindex,
}: {
  error: Error;
  retrying: boolean;
  onRetry: () => void;
  onReindex: () => void;
}) {
  const code = error instanceof ApiError ? error.code : null;
  const message =
    code === "model_unavailable" || code === "palette_missing"
      ? error.message
      : code === "embedding_failed"
        ? "This image could not be indexed for similarity search."
        : "Similar pieces could not be loaded.";
  return (
    <div role="alert" className="rounded-2xl border border-line bg-paper-raised p-6">
      <p className="text-sm">{message}</p>
      {code === "model_unavailable" && (
        <p className="mt-2 text-xs text-ink-muted">
          Uploads and colour palettes keep working without it.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        {code === "embedding_failed" ? (
          <Button variant="secondary" onClick={onReindex} disabled={retrying}>
            <RefreshCw aria-hidden className="size-4" /> Index this image again
          </Button>
        ) : (
          <Button variant="secondary" onClick={onRetry} disabled={retrying}>
            <RefreshCw aria-hidden className="size-4" /> Try again
          </Button>
        )}
      </div>
    </div>
  );
}

function scoreLabel({ similarity, palette_distance }: SimilarItem): { short: string; long: string } {
  if (palette_distance != null) {
    return { short: `ΔE ${palette_distance.toFixed(1)}`, long: `colour distance ${palette_distance.toFixed(1)}` };
  }
  const value = (similarity ?? 0).toFixed(2);
  return { short: value, long: `similarity ${value}` };
}

function SimilarCard({ result, index }: { result: SimilarItem; index: number }) {
  const { item, reasons } = result;
  const score = scoreLabel(result);
  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 8) * 0.04 }}
    >
      <Link
        href={`/items/${item.id}`}
        className="group block overflow-hidden rounded-xl border border-line bg-paper-raised shadow-soft"
        aria-label={`${item.type} — ${score.long}`}
      >
        <div className="aspect-[3/4] overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element -- private image served by the API */}
          <img
            src={apiUrl(item.thumbnail_url)}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        </div>
        {item.palette && <PaletteStrip colors={item.palette.colors} />}
        <div className="flex items-center justify-between gap-2 px-3 py-2.5 text-xs">
          <span className="uppercase tracking-[0.18em] text-ink-muted">{item.type}</span>
          <span className="font-mono">{score.short}</span>
        </div>
      </Link>
      {reasons.length > 0 && (
        <ul className="mt-2 space-y-0.5 px-1 text-[11px] leading-snug text-ink-muted" aria-label="Why this matched">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </motion.li>
  );
}
