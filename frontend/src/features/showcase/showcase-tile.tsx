import Link from "next/link";

import { PaletteStrip } from "@/features/palette/palette-strip";
import { apiUrl } from "@/lib/api-client";
import type { ShowcaseItem } from "@/types/api";

export function recordNumber(id: string): string {
  return id.slice(0, 6).toUpperCase();
}

/** One published piece in a grid: image, palette band, type and record number. */
export function ShowcaseTile({ item }: { item: ShowcaseItem }) {
  const colours = item.palette?.colors ?? [];
  return (
    <Link href={`/showcase/${item.id}`} className="group block">
      <span className="block aspect-[3/4] overflow-hidden bg-paper-raised">
        {/* eslint-disable-next-line @next/next/no-img-element -- served by the API */}
        <img
          src={apiUrl(item.thumbnail_url)}
          alt={`${item.type}${colours.length ? ` in ${colours.slice(0, 2).map((c) => c.name).join(" and ")}` : ""}`}
          loading="lazy"
          className="size-full object-cover transition-transform duration-700 group-hover:scale-[1.02] motion-reduce:transition-none"
        />
      </span>
      {colours.length > 0 && <PaletteStrip colors={colours} />}
      <span className="flex items-baseline justify-between gap-2 border-b border-line py-2.5">
        <span className="text-[11px] uppercase tracking-[0.2em] text-ink-muted">{item.type}</span>
        <span className="font-display text-xs italic text-ink-muted">Record {recordNumber(item.id)}</span>
      </span>
    </Link>
  );
}
