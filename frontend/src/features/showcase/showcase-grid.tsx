"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { FilterChip, TYPE_NAMES } from "@/features/gallery/gallery";
import { ApiError, apiUrl } from "@/lib/api-client";
import { FAMILY_SWATCH } from "@/lib/colour-families";
import { filtersToSearch, hasActiveFilters, parseFilters, type GalleryFilters } from "@/lib/gallery-filters";
import { cn } from "@/lib/cn";
import { getShowcaseSummary, listShowcase, listShowcaseCollections } from "@/services/showcase";
import { ITEM_TYPES } from "@/types/api";

import { ShowcaseTile } from "./showcase-tile";

const PAGE_SIZE = 24;

/** The public showcase: the owner's published pieces, searchable by tag, colour and type. */
export function ShowcaseGrid() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // Only filters a visitor can use (the owner's "published" filter means nothing here).
  const filters = useMemo(() => ({ ...parseFilters(searchParams), published: undefined }), [searchParams]);
  const setFilters = useCallback(
    (next: GalleryFilters) => {
      const search = filtersToSearch({ ...next, published: undefined });
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const summary = useQuery({ queryKey: ["showcase", "summary"], queryFn: getShowcaseSummary });
  const collections = useQuery({
    queryKey: ["showcase", "collections"],
    queryFn: listShowcaseCollections,
    enabled: summary.isSuccess,
  });
  const pieces = useInfiniteQuery({
    queryKey: ["showcase", "list", filtersToSearch(filters)],
    queryFn: ({ pageParam }) => listShowcase(filters, PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined),
    enabled: summary.isSuccess,
  });

  if (summary.isPending) return <div role="status" aria-label="Loading the showcase" className="h-96 animate-pulse bg-ink/[0.05]" />;
  if (summary.isError) {
    const notSetUp = summary.error instanceof ApiError && summary.error.code === "showcase_not_set_up";
    return (
      <div role={notSetUp ? undefined : "alert"} className="border-y border-line py-20 text-center">
        <p className="font-display text-3xl">{notSetUp ? "The showcase opens soon" : "The showcase could not be loaded."}</p>
        <p className="mx-auto mt-3 max-w-sm text-sm text-ink-muted">
          {notSetUp ? "Nothing has been published here yet." : summary.error.message}
        </p>
        {!notSetUp && (
          <Button className="mt-6" variant="secondary" onClick={() => void summary.refetch()}>
            Try again
          </Button>
        )}
      </div>
    );
  }

  const items = pieces.data?.pages.flatMap((page) => page.items) ?? [];
  const total = pieces.data?.pages[0]?.total;
  return (
    <div className="space-y-12">
      <p className="max-w-2xl text-ink-muted">
        Pieces from the archive of <span className="text-ink">{summary.data.owner_name}</span>, with the colours
        Thread measured in each and the craft it recognised.
      </p>

      <Filters
        key={filters.q}
        filters={filters}
        onChange={setFilters}
        families={summary.data.color_families.map((f) => f.family)}
      />

      <div>
        {pieces.isPending ? (
          <div role="status" aria-label="Loading pieces" className="h-64 animate-pulse bg-ink/[0.05]" />
        ) : pieces.isError ? (
          <div role="alert" className="border-y border-danger/30 py-12 text-center">
            <p className="font-display text-xl">These pieces could not be loaded.</p>
            <Button className="mt-6" variant="secondary" onClick={() => void pieces.refetch()}>
              Try again
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="border-y border-line py-16 text-center text-ink-muted">
            {hasActiveFilters(filters) ? "No published pieces match." : "Nothing has been published yet."}
          </p>
        ) : (
          <>
            <p className="text-sm text-ink-muted" aria-live="polite">
              {total} {total === 1 ? "piece" : "pieces"}
            </p>
            <ul aria-label="Published pieces" className="mt-4 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((item) => (
                <li key={item.id}>
                  <ShowcaseTile item={item} />
                </li>
              ))}
            </ul>
            {pieces.hasNextPage && (
              <div className="mt-10 text-center">
                <Button variant="secondary" onClick={() => void pieces.fetchNextPage()} disabled={pieces.isFetchingNextPage}>
                  {pieces.isFetchingNextPage ? "Loading…" : "Show more"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {collections.data && collections.data.length > 0 && (
        <section aria-labelledby="showcase-collections" className="border-t border-ink pt-5">
          <h2 id="showcase-collections" className="font-display text-2xl">
            Collections
          </h2>
          <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {collections.data.map((c) => (
              <li key={c.id}>
                <Link href={`/showcase/collections/${c.id}`} className="group block">
                  <span className="grid aspect-[4/3] grid-cols-2 gap-px bg-line">
                    {c.cover_thumbnails.slice(0, 4).map((src) => (
                      // eslint-disable-next-line @next/next/no-img-element -- served by the API
                      <img key={src} src={apiUrl(src)} alt="" className="size-full object-cover" />
                    ))}
                  </span>
                  <span className="mt-3 block font-display text-xl group-hover:underline">{c.name}</span>
                  <span className="text-xs text-ink-muted">
                    {c.item_count} {c.item_count === 1 ? "piece" : "pieces"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Filters({
  filters,
  onChange,
  families,
}: {
  filters: GalleryFilters;
  onChange: (next: GalleryFilters) => void;
  families: GalleryFilters["colors"];
}) {
  const [q, setQ] = useState(filters.q); // remounted (key) when the URL's query changes
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onChange({ ...filters, q });
  };
  return (
    <div className="space-y-5 border-y border-line py-5">
      <form role="search" onSubmit={submit} className="flex max-w-xl items-center gap-2">
        <label className="flex-1">
          <span className="sr-only">Search the showcase</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={100}
            placeholder="Search by colour, craft or type, e.g. ikat"
            className="block w-full rounded-[2px] border border-line bg-paper-raised px-3 py-2 text-base text-ink sm:text-sm"
          />
        </label>
        <Button type="submit" variant="secondary">
          <Search aria-hidden className="size-4" /> Search
        </Button>
      </form>
      {families.length > 0 && (
        <div role="group" aria-label="Filter by colour" className="flex flex-wrap items-center gap-1.5">
          {families.map((family) => {
            const active = filters.colors.includes(family);
            return (
              <button
                key={family}
                type="button"
                aria-pressed={active}
                aria-label={family}
                title={family}
                onClick={() =>
                  onChange({
                    ...filters,
                    colors: active ? filters.colors.filter((c) => c !== family) : [...filters.colors, family],
                  })
                }
                className={cn("size-6 border transition-transform", active ? "scale-110 border-ink" : "border-ink/15")}
                style={{ backgroundColor: FAMILY_SWATCH[family] }}
              />
            );
          })}
        </div>
      )}
      <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-x-6 gap-y-2">
        <FilterChip active={filters.type === undefined} onClick={() => onChange({ ...filters, type: undefined })}>
          All
        </FilterChip>
        {ITEM_TYPES.map((value) => (
          <FilterChip
            key={value}
            active={filters.type === value}
            onClick={() => onChange({ ...filters, type: filters.type === value ? undefined : value })}
          >
            {TYPE_NAMES[value]}
          </FilterChip>
        ))}
      </div>
    </div>
  );
}
