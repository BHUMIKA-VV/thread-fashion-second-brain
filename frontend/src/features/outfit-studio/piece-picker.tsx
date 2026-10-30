"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Check, Plus, Replace } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useState } from "react";

import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/api-client";
import { listItems } from "@/services/items";
import { ITEM_TYPES, type Item, type ItemType } from "@/types/api";

import { pieceLabel } from "./names";

const PAGE_SIZE = 24;

/** Your archive, a page at a time and searchable, so opening the studio never loads it all. */
export function PiecePicker({
  chosen,
  full,
  replacing,
  onChoose,
}: {
  chosen: ReadonlySet<string>;
  full: boolean;
  replacing: string | null;
  onChoose: (item: Item) => void;
}) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState<ItemType | "">("");
  const q = useDeferredValue(search.trim());
  const query = useInfiniteQuery({
    queryKey: ["items", "list", "studio", q, type],
    queryFn: ({ pageParam }) =>
      listItems({ q: q || undefined, type: type || undefined, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = Boolean(q || type);

  return (
    <section aria-labelledby="picker-title">
      <h2 id="picker-title" className="font-display text-2xl">
        Your archive
      </h2>
      {replacing && (
        <p role="status" className="mt-2 border-l-2 border-clay pl-3 text-sm">
          Choose the piece that takes the place of {replacing}.
        </p>
      )}
      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <label className="text-xs text-ink-muted">
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={100}
            className="mt-1 block w-full rounded-[2px] border border-line bg-paper-raised px-3 py-2 text-sm text-ink"
          />
        </label>
        <label className="text-xs text-ink-muted">
          Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ItemType | "")}
            className="mt-1 block rounded-[2px] border border-line bg-paper-raised px-2 py-2 text-sm capitalize text-ink"
          >
            <option value="">All</option>
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>

      {query.isPending ? (
        <div role="status" aria-label="Loading your archive" className="mt-4 h-64 animate-pulse bg-ink/[0.05]" />
      ) : query.isError ? (
        <div role="alert" className="mt-4 text-sm text-danger">
          Your archive could not be loaded.{" "}
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="mt-4 border-y border-line py-8 text-center text-sm text-ink-muted">
          {filtered ? (
            "No pieces match."
          ) : (
            <>
              Your archive is empty.{" "}
              <Link href="/upload" className="underline">
                Add a piece
              </Link>{" "}
              to begin.
            </>
          )}
        </p>
      ) : (
        <>
          <ul
            tabIndex={0}
            aria-label="Pieces you can add"
            className="mt-4 grid max-h-[32rem] grid-cols-3 gap-2 overflow-y-auto pr-1 lg:grid-cols-2"
          >
            {items.map((item) => {
              const inOutfit = chosen.has(item.id);
              const label = pieceLabel(item);
              // aria-disabled, not disabled: the button you just used keeps keyboard focus.
              const unavailable = inOutfit || (full && !replacing);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => !unavailable && onChoose(item)}
                    aria-disabled={unavailable}
                    aria-label={inOutfit ? `${label}, in this outfit` : `${replacing ? "Use" : "Add"} ${label}`}
                    className="group relative block w-full overflow-hidden bg-paper-raised aria-disabled:cursor-default"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- private image served by the API */}
                    <img
                      src={apiUrl(item.thumbnail_url)}
                      alt=""
                      loading="lazy"
                      className={`aspect-[4/5] w-full object-cover ${inOutfit ? "opacity-40" : ""}`}
                    />
                    <span
                      aria-hidden
                      className="absolute right-1 top-1 flex size-6 items-center justify-center bg-paper-raised text-ink"
                    >
                      {inOutfit ? <Check className="size-3.5" /> : replacing ? <Replace className="size-3.5" /> : <Plus className="size-3.5" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {query.hasNextPage && (
            <Button
              variant="secondary"
              className="mt-3 w-full"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
            >
              {query.isFetchingNextPage ? "Loading…" : "Show more pieces"}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
