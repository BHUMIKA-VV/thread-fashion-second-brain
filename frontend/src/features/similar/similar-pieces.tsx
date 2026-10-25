"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { PaletteStrip } from "@/features/palette/palette-strip";
import { ApiError, apiUrl } from "@/lib/api-client";
import { getSimilar, indexItem } from "@/services/items";
import type { SimilarItem } from "@/types/api";

export function SimilarPieces({ itemId }: { itemId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["items", "similar", itemId],
    queryFn: () => getSimilar(itemId),
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

  return (
    <section aria-labelledby="similar-title" className="mt-16">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="similar-title" className="font-display text-2xl">
            Similar pieces
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            From your own library, ranked by visual similarity of the whole image.
          </p>
        </div>
      </div>

      <div className="mt-6" aria-live="polite" aria-busy={query.isPending}>
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
            {query.data.not_indexed > 0
              ? "None of your other pieces could be compared yet."
              : "Nothing to compare with yet — save more pieces to see visual matches."}
          </p>
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {query.data.results.map((result, index) => (
                <SimilarCard key={result.item.id} result={result} index={index} />
              ))}
            </ul>
            <p className="mt-4 text-xs text-ink-muted">
              Compared with {query.data.compared} of your pieces
              {query.data.not_indexed > 0 ? ` (${query.data.not_indexed} could not be compared)` : ""}.
              Scores are cosine similarity of image embeddings — useful for ranking, not a percentage
              match.
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
    code === "model_unavailable"
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

function SimilarCard({ result, index }: { result: SimilarItem; index: number }) {
  const { item, similarity } = result;
  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 8) * 0.04 }}
    >
      <Link
        href={`/items/${item.id}`}
        className="group block overflow-hidden rounded-xl border border-line bg-paper-raised shadow-soft"
        aria-label={`${item.type} — similarity ${similarity.toFixed(2)}`}
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
          <span className="font-mono">{similarity.toFixed(2)}</span>
        </div>
      </Link>
    </motion.li>
  );
}
