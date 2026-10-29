"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { ButtonLink } from "@/components/ui/button";
import { PaletteStrip } from "@/features/palette/palette-strip";
import { apiUrl } from "@/lib/api-client";
import { filtersToSearch, EMPTY_FILTERS } from "@/lib/gallery-filters";
import { getLibrarySummary } from "@/services/items";
import { ITEM_TYPES, type ItemType, type LibrarySummary } from "@/types/api";

const TYPE_NAMES: Record<ItemType, string> = {
  outfit: "Outfits",
  garment: "Garments",
  fabric: "Fabric swatches",
  accessory: "Accessories",
  other: "Other",
};

const galleryLink = (change: Partial<typeof EMPTY_FILTERS>) =>
  `/gallery?${filtersToSearch({ ...EMPTY_FILTERS, ...change })}`;

/** Real counts from your library; no derived "insights". */
export function Dashboard() {
  const query = useQuery({ queryKey: ["items", "summary"], queryFn: getLibrarySummary });

  if (query.isPending) {
    return <div className="h-80 animate-pulse rounded-2xl bg-ink/[0.06]" aria-label="Loading dashboard" />;
  }
  if (query.isError) {
    return (
      <div role="alert" className="rounded-2xl border border-danger/20 bg-danger/5 p-8 text-center">
        <p className="font-display text-xl">The dashboard could not be loaded.</p>
        <button type="button" className="mt-4 text-sm underline" onClick={() => void query.refetch()}>
          Try again
        </button>
      </div>
    );
  }
  const summary = query.data;
  if (summary.total === 0) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-dashed border-ink/20 px-6 py-20 text-center">
        <p className="font-display text-2xl">Your library is empty</p>
        <p className="mt-2 text-sm text-ink-muted">Upload a few pieces and this page fills itself in.</p>
        <ButtonLink href="/upload" className="mt-6">
          Upload images
        </ButtonLink>
      </div>
    );
  }
  return (
    <div className="space-y-12">
      <Counts summary={summary} />
      <Recent summary={summary} />
      <div className="grid gap-10 lg:grid-cols-2">
        <Families summary={summary} />
        <Tags summary={summary} />
      </div>
    </div>
  );
}

function Counts({ summary }: { summary: LibrarySummary }) {
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Stat label="Pieces" value={summary.total} href="/gallery" />
      {ITEM_TYPES.filter((t) => summary.by_type[t]).map((type) => (
        <Stat key={type} label={TYPE_NAMES[type]} value={summary.by_type[type] ?? 0} href={galleryLink({ type })} />
      ))}
      <Stat label="Collections" value={summary.collections} href="/collections" />
    </dl>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="rounded-2xl border border-line bg-paper-raised p-4 hover:border-ink/40">
      <dt className="text-xs uppercase tracking-[0.18em] text-ink-muted">{label}</dt>
      <dd className="mt-1 font-display text-3xl">{value}</dd>
    </Link>
  );
}

function Recent({ summary }: { summary: LibrarySummary }) {
  return (
    <section aria-labelledby="recent-title">
      <div className="flex items-end justify-between">
        <h2 id="recent-title" className="font-display text-2xl">
          Recently added
        </h2>
        <Link href="/gallery" className="text-sm underline underline-offset-2">
          All pieces
        </Link>
      </div>
      <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
        {summary.recent.map((item) => (
          <li key={item.id}>
            <Link href={`/items/${item.id}`} className="block overflow-hidden rounded-lg border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element -- private image served by the API */}
              <img src={apiUrl(item.thumbnail_url)} alt={`${item.type} image`} className="aspect-[3/4] w-full object-cover" />
              {item.palette && <PaletteStrip colors={item.palette.colors} />}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Families({ summary }: { summary: LibrarySummary }) {
  const max = Math.max(1, ...summary.color_families.map((f) => f.items));
  return (
    <section aria-labelledby="families-title">
      <h2 id="families-title" className="font-display text-2xl">
        Colour families
      </h2>
      <p className="mt-1 text-xs text-ink-muted">Pieces whose palette contains each family.</p>
      {summary.color_families.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">No palettes yet.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {summary.color_families.map(({ family, items }) => (
            <li key={family}>
              <Link href={galleryLink({ colors: [family] })} className="flex items-center gap-3 text-sm hover:underline">
                <span className="w-16 capitalize">{family}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink/10">
                  <span className="block h-full bg-ink/60" style={{ width: `${(items / max) * 100}%` }} />
                </span>
                <span className="w-8 text-right font-mono text-xs">{items}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Tags({ summary }: { summary: LibrarySummary }) {
  return (
    <section aria-labelledby="tags-title">
      <h2 id="tags-title" className="font-display text-2xl">
        Most used tags
      </h2>
      <p className="mt-1 text-xs text-ink-muted">AI tags you kept plus tags you added.</p>
      {summary.tags.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">No tags yet.</p>
      ) : (
        <ul className="mt-4 flex flex-wrap gap-2">
          {summary.tags.map(({ category, tag, items }) => (
            <li key={`${category}:${tag}`}>
              <Link
                href={galleryLink({ tags: [`${category}:${tag}`] })}
                className="inline-flex items-center gap-2 rounded-full border border-line bg-paper-raised px-3 py-1 text-sm hover:border-ink/40"
              >
                {tag} <span className="text-xs text-ink-muted">{category} · {items}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
