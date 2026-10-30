"use client";

import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ApiError, apiUrl } from "@/lib/api-client";
import { createOutfit, listOutfits } from "@/services/outfits";
import type { OutfitSummary } from "@/types/api";

import { SEASON_NAMES } from "./names";

const PAGE_SIZE = 24;

export function OutfitList() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  const query = useInfiniteQuery({
    queryKey: ["outfits", "list", q],
    queryFn: ({ pageParam }) => listOutfits({ q: q || undefined, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.outfits.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });
  const create = useMutation({
    mutationFn: () => createOutfit(name.trim()),
    onSuccess: (outfit) => router.push(`/outfit-studio/${outfit.id}`),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) create.mutate();
  };
  const outfits = query.data?.pages.flatMap((page) => page.outfits) ?? [];

  return (
    <div className="space-y-10">
      <form onSubmit={submit} aria-label="New outfit" className="flex flex-wrap items-end gap-3 border-y border-line py-5">
        <label className="min-w-48 flex-1 text-xs text-ink-muted">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="e.g. Sangeet evening"
            className="mt-1 block w-full rounded-[2px] border border-line bg-paper-raised px-3 py-2 text-sm text-ink"
          />
        </label>
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          <Plus aria-hidden className="size-4" /> {create.isPending ? "Creating…" : "Start an outfit"}
        </Button>
        {create.isError && (
          <p role="alert" className="w-full text-sm text-danger">
            {create.error instanceof ApiError ? create.error.message : "The outfit could not be created."}
          </p>
        )}
      </form>

      <label className="block max-w-sm text-xs text-ink-muted">
        Search your outfits
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          maxLength={100}
          className="mt-1 block w-full rounded-[2px] border border-line bg-paper-raised px-3 py-2 text-sm text-ink"
        />
      </label>

      {query.isPending ? (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading outfits">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-64 animate-pulse rounded-[2px] bg-ink/[0.06]" />
          ))}
        </ul>
      ) : query.isError ? (
        <div role="alert" className="text-sm text-danger">
          Outfits could not be loaded.{" "}
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      ) : outfits.length === 0 ? (
        <div className="border-b border-line px-6 py-14 text-center">
          <p className="font-display text-2xl">{q ? "No outfits match that search" : "No outfits yet"}</p>
          {!q && (
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
              Name one above, then compose it from the pieces in your archive.
            </p>
          )}
        </div>
      ) : (
        <>
          <ul className="grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3" aria-label="Your outfits">
            {outfits.map((outfit) => (
              <li key={outfit.id}>
                <OutfitCard outfit={outfit} />
              </li>
            ))}
          </ul>
          {query.hasNextPage && (
            <Button variant="secondary" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              {query.isFetchingNextPage ? "Loading…" : "Show more outfits"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

export function OutfitCard({ outfit }: { outfit: OutfitSummary }) {
  const covers = outfit.cover_thumbnails;
  const facts = [outfit.occasion, outfit.season ? SEASON_NAMES[outfit.season] : null].filter(Boolean);
  return (
    <Link href={`/outfit-studio/${outfit.id}`} className="group block">
      <div className="grid aspect-[4/3] grid-cols-2 grid-rows-2 gap-0.5 bg-line">
        {[0, 1, 2, 3].map((i) =>
          covers[i] ? (
            // eslint-disable-next-line @next/next/no-img-element -- private image served by the API
            <img key={i} src={apiUrl(covers[i])} alt="" loading="lazy" className="size-full object-cover" />
          ) : (
            <span key={i} className="bg-paper" />
          ),
        )}
      </div>
      <div className="border-b border-line py-4">
        <p className="font-display text-2xl underline-offset-4 group-hover:underline">{outfit.name}</p>
        <p className="mt-1 text-xs text-ink-muted">
          {outfit.piece_count} {outfit.piece_count === 1 ? "piece" : "pieces"}
          {facts.length > 0 && ` · ${facts.join(" · ")}`}
        </p>
      </div>
    </Link>
  );
}
