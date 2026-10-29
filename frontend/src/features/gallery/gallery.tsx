"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ImagePlus } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { ProcessingBadge } from "@/components/processing-badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { GalleryFilterBar } from "@/features/gallery/filter-bar";
import { PaletteStrip } from "@/features/palette/palette-strip";
import { apiUrl } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import {
  EMPTY_FILTERS,
  filtersToSearch,
  hasActiveFilters,
  parseFilters,
  type GalleryFilters,
} from "@/lib/gallery-filters";
import { listItems } from "@/services/items";
import { ITEM_TYPES, type Item, type ItemType } from "@/types/api";

const PAGE_SIZE = 24;

export const TYPE_NAMES: Record<ItemType, string> = {
  outfit: "Outfits",
  garment: "Garments",
  fabric: "Fabrics",
  accessory: "Accessories",
  other: "Other",
};

/** The gallery. Reads its filters from the URL, so it must sit inside <Suspense>. */
export function Gallery() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);

  const setFilters = useCallback(
    (next: GalleryFilters) => {
      const search = filtersToSearch(next);
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const query = useInfiniteQuery({
    queryKey: ["items", "list", filtersToSearch(filters)],
    queryFn: ({ pageParam }) =>
      listItems({
        q: filters.q.trim() || undefined,
        tags: filters.tags,
        colors: filters.colors,
        type: filters.type,
        sort: filters.sort,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const next = last.offset + last.items.length;
      return next < last.total ? next : undefined;
    },
  });

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const reasons = Object.assign({}, ...(query.data?.pages.map((page) => page.reasons ?? {}) ?? []));
  const total = query.data?.pages[0]?.total;
  const filtered = hasActiveFilters(filters);

  return (
    <div>
      <GalleryFilterBar filters={filters} onChange={setFilters} />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-x-6 gap-y-2">
          <FilterChip active={filters.type === undefined} onClick={() => setFilters({ ...filters, type: undefined })}>
            All
          </FilterChip>
          {ITEM_TYPES.map((value) => (
            <FilterChip
              key={value}
              active={filters.type === value}
              onClick={() => setFilters({ ...filters, type: filters.type === value ? undefined : value })}
            >
              {TYPE_NAMES[value]}
            </FilterChip>
          ))}
        </div>
        {total !== undefined && (
          <p className="text-sm text-ink-muted" aria-live="polite">
            {total} {total === 1 ? "piece" : "pieces"}
            {filtered ? " match" : ""}
          </p>
        )}
      </div>

      <div className="mt-8">
        {query.isPending ? (
          <GallerySkeleton />
        ) : query.isError ? (
          <div role="alert" className="border-y border-danger/30 py-12 text-center">
            <p className="font-display text-xl">The gallery could not be loaded.</p>
            <p className="mt-2 text-sm text-ink-muted">{query.error.message}</p>
            <Button className="mt-6" variant="secondary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </div>
        ) : items.length === 0 ? (
          filtered ? (
            <div className="flex flex-col items-center border-y border-line px-6 py-16 text-center">
              <p className="font-display text-2xl">No pieces match these filters</p>
              <p className="mt-2 max-w-sm text-sm text-ink-muted">
                Remove a filter above, or clear them all to see your whole library.
              </p>
              <Button className="mt-6" variant="secondary" onClick={() => setFilters(EMPTY_FILTERS)}>
                Clear all filters
              </Button>
            </div>
          ) : (
            <EmptyState filtered={false} />
          )
        ) : (
          <>
            {/* Editorial grid: every seventh piece is featured across two columns and rows. */}
            <ul className="grid grid-flow-dense grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4" aria-label="Your library">
              {items.map((item, index) => (
                <GalleryCard key={item.id} item={item} index={index} reasons={reasons[item.id]} />
              ))}
            </ul>
            {query.hasNextPage && (
              <div className="mt-10 flex justify-center">
                <Button
                  variant="secondary"
                  onClick={() => void query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                >
                  {query.isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "border-b py-1 text-sm transition-colors",
        active ? "border-ink text-ink" : "border-transparent text-ink-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function GalleryCard({ item, index, reasons }: { item: Item; index: number; reasons?: string[] }) {
  const featured = index % 7 === 0;
  return (
    <motion.li
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index, 12) * 0.03 }}
      className={cn("flex flex-col", featured && "col-span-2 row-span-2")}
    >
      <Link href={`/items/${item.id}`} className="group flex flex-1 flex-col">
        <div className={cn("relative overflow-hidden bg-paper-raised", featured ? "min-h-0 flex-1" : "aspect-[3/4]")}>
          {/* eslint-disable-next-line @next/next/no-img-element -- private image served by the API */}
          <img
            src={apiUrl(item.thumbnail_url)}
            alt={item.notes ? item.notes.slice(0, 120) : `${item.type} image`}
            loading="lazy"
            className={cn(
              "size-full object-cover transition-transform duration-700 group-hover:scale-[1.02] motion-reduce:transition-none",
              featured && "absolute inset-0",
            )}
          />
        </div>
        {item.palette && <PaletteStrip colors={item.palette.colors} />}
        <div className="flex items-center justify-between gap-2 border-b border-line py-2.5">
          <span className="text-[11px] uppercase tracking-[0.2em] text-ink-muted">{item.type}</span>
          <ProcessingBadge status={item.processing_status} />
        </div>
      </Link>
      {reasons && reasons.length > 0 && (
        <p role="note" className="mt-1.5 text-[11px] text-ink-muted" aria-label="Why this matched">
          {reasons.join(" · ")}
        </p>
      )}
    </motion.li>
  );
}

function GallerySkeleton() {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true" aria-label="Loading gallery">
      {Array.from({ length: 8 }, (_, i) => (
        <li key={i}>
          <div className="aspect-[3/4] animate-pulse bg-ink/[0.05]" />
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center border-y border-line px-6 py-20 text-center">
      <ImagePlus aria-hidden className="size-8 text-ink-muted" />
      <p className="mt-4 font-display text-2xl">
        {filtered ? "Nothing of this type yet" : "Your library is empty"}
      </p>
      <p className="mt-2 max-w-sm text-sm text-ink-muted">
        Save outfits, garments and fabric swatches to start building your visual memory.
      </p>
      <ButtonLink href="/upload" className="mt-6">
        Upload images
      </ButtonLink>
    </div>
  );
}
