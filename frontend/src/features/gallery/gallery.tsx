"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ImagePlus } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";

import { ProcessingBadge } from "@/components/processing-badge";
import { PaletteStrip } from "@/features/palette/palette-strip";
import { Button, ButtonLink } from "@/components/ui/button";
import { apiUrl } from "@/lib/api-client";
import { cn } from "@/lib/cn";
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

export function Gallery() {
  const [type, setType] = useState<ItemType | undefined>();
  const query = useInfiniteQuery({
    queryKey: ["items", { type }],
    queryFn: ({ pageParam }) => listItems({ type, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const next = last.offset + last.items.length;
      return next < last.total ? next : undefined;
    },
  });

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const total = query.data?.pages[0]?.total;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-2">
          <FilterChip active={type === undefined} onClick={() => setType(undefined)}>
            All
          </FilterChip>
          {ITEM_TYPES.map((value) => (
            <FilterChip key={value} active={type === value} onClick={() => setType(value)}>
              {TYPE_NAMES[value]}
            </FilterChip>
          ))}
        </div>
        {total !== undefined && (
          <p className="text-sm text-ink-muted" aria-live="polite">
            {total} {total === 1 ? "piece" : "pieces"}
          </p>
        )}
      </div>

      <div className="mt-8">
        {query.isPending ? (
          <GallerySkeleton />
        ) : query.isError ? (
          <div role="alert" className="rounded-2xl border border-danger/20 bg-danger/5 p-8 text-center">
            <p className="font-display text-xl">The gallery could not be loaded.</p>
            <p className="mt-2 text-sm text-ink-muted">{query.error.message}</p>
            <Button className="mt-6" variant="secondary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState filtered={type !== undefined} />
        ) : (
          <>
            <ul className="columns-2 gap-4 sm:columns-3 lg:columns-4" aria-label="Your library">
              {items.map((item, index) => (
                <GalleryCard key={item.id} item={item} index={index} />
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
        "rounded-full border px-4 py-1.5 text-sm transition-colors",
        active
          ? "border-ink bg-ink text-paper"
          : "border-line bg-paper-raised text-ink-muted hover:border-ink/40 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function GalleryCard({ item, index }: { item: Item; index: number }) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index, 12) * 0.03 }}
      className="mb-4 break-inside-avoid"
    >
      <Link
        href={`/items/${item.id}`}
        className="group block overflow-hidden rounded-xl border border-line bg-paper-raised shadow-soft"
      >
        <div className="overflow-hidden" style={{ aspectRatio: `${item.width} / ${item.height}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- private image served by the API */}
          <img
            src={apiUrl(item.thumbnail_url)}
            alt={item.notes ? item.notes.slice(0, 120) : `${item.type} image`}
            loading="lazy"
            className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        </div>
        {item.palette && <PaletteStrip colors={item.palette.colors} />}
        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
          <span className="text-xs uppercase tracking-[0.18em] text-ink-muted">{item.type}</span>
          <ProcessingBadge status={item.processing_status} />
        </div>
      </Link>
    </motion.li>
  );
}

function GallerySkeleton() {
  const heights = [220, 300, 260, 340, 240, 280, 320, 230];
  return (
    <ul className="columns-2 gap-4 sm:columns-3 lg:columns-4" aria-busy="true" aria-label="Loading gallery">
      {heights.map((height, i) => (
        <li key={i} className="mb-4 break-inside-avoid">
          <div className="animate-pulse rounded-xl bg-ink/[0.06]" style={{ height }} />
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-ink/20 px-6 py-20 text-center">
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
