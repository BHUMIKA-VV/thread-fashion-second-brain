"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button, ButtonLink } from "@/components/ui/button";
import { apiUrl } from "@/lib/api-client";
import { FAMILY_SWATCH } from "@/lib/colour-families";
import { galleryLink } from "@/lib/gallery-filters";
import { getLibrarySummary, listItems } from "@/services/items";
import type { Item } from "@/types/api";

const PALETTES_SHOWN = 24;

/**
 * Colour as Thread measured it across your archive: the families your pieces wear (each a way
 * into the colour filter) and the palettes themselves, swatch by swatch with names and values.
 * The family swatches are labels; every other colour on this page is a measured one.
 */
export function ColourLab() {
  const summary = useQuery({ queryKey: ["items", "summary"], queryFn: getLibrarySummary });
  const pieces = useQuery({
    queryKey: ["items", "list", "colour-lab"],
    queryFn: () => listItems({ limit: PALETTES_SHOWN }),
  });

  if (summary.isPending || pieces.isPending) {
    return <div role="status" className="mt-10 h-96 animate-pulse bg-ink/[0.05]" aria-label="Loading colours" />;
  }
  if (summary.isError || pieces.isError) {
    const error = summary.error ?? pieces.error;
    return (
      <div role="alert" className="mt-10 border-y border-danger/30 py-12 text-center">
        <p className="font-display text-xl">Colours could not be loaded.</p>
        <p className="mt-2 text-sm text-ink-muted">{error?.message}</p>
        <Button
          className="mt-6"
          variant="secondary"
          onClick={() => {
            void summary.refetch();
            void pieces.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  const families = summary.data.color_families.filter((f) => f.items > 0);
  const withPalettes = pieces.data.items.filter((item) => item.palette && item.palette.colors.length > 0);
  if (families.length === 0 || withPalettes.length === 0) {
    return (
      <div className="mt-10 border-y border-line py-20 text-center">
        <p className="font-display text-3xl">No colours measured yet</p>
        <p className="mx-auto mt-3 max-w-sm text-sm text-ink-muted">
          Every piece you add gets its palette measured. Add a garment or a fabric to begin.
        </p>
        <ButtonLink href="/upload" className="mt-8">
          Add a piece
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="mt-12 space-y-20">
      <section aria-labelledby="families-title">
        <div className="flex items-baseline justify-between gap-4 border-t border-ink pt-5">
          <h2 id="families-title" className="font-display text-2xl">
            Families in your archive
          </h2>
          <p className="text-xs text-ink-muted">Choose one to see the pieces that wear it</p>
        </div>
        <ul className="mt-6 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
          {families.map((family) => (
            <li key={family.family} className="bg-paper">
              <Link
                href={galleryLink({ colors: [family.family] })}
                className="group block p-4"
              >
                <span
                  aria-hidden
                  className="block aspect-[4/3] border border-ink/10 transition-transform duration-500 group-hover:scale-[0.97] motion-reduce:transition-none"
                  style={{ backgroundColor: FAMILY_SWATCH[family.family] }}
                />
                <span className="mt-3 flex items-baseline justify-between">
                  {/* The visible "White 3" is the link's name, so voice control can say it. */}
                  <span className="font-display text-lg capitalize">{family.family}</span>{" "}
                  <span className="text-xs text-ink-muted">
                    {family.items}{" "}
                    <span className="sr-only">{family.items === 1 ? "piece" : "pieces"}</span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="palettes-title">
        <div className="flex items-baseline justify-between gap-4 border-t border-ink pt-5">
          <h2 id="palettes-title" className="font-display text-2xl">
            Measured palettes
          </h2>
          <p className="text-xs text-ink-muted">
            The newest {withPalettes.length} {withPalettes.length === 1 ? "piece" : "pieces"}, in CIELAB proportions
          </p>
        </div>
        <ol className="mt-2">
          {withPalettes.map((item) => (
            <PaletteRow key={item.id} item={item} />
          ))}
        </ol>
      </section>
    </div>
  );
}

function PaletteRow({ item }: { item: Item }) {
  const colours = item.palette!.colors;
  return (
    <li className="grid grid-cols-[64px_1fr] items-start gap-4 border-b border-line py-5 sm:grid-cols-[88px_1fr] sm:gap-6">
      <Link href={`/items/${item.id}`} className="block bg-paper-raised" aria-label={`Open ${item.notes?.slice(0, 60) || `this ${item.type}`}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- private image served by the API */}
        <img src={apiUrl(item.thumbnail_url)} alt="" loading="lazy" className="aspect-[3/4] w-full object-cover" />
      </Link>
      <div className="min-w-0">
        <div className="flex h-14 overflow-hidden sm:h-20" role="img" aria-label={`Palette: ${colours.map((c) => `${c.name} ${Math.round(c.percentage)}%`).join(", ")}`}>
          {colours.map((c) => (
            <span key={c.hex} className="h-full" style={{ backgroundColor: c.hex, width: `${c.percentage}%` }} />
          ))}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
          {colours.slice(0, 4).map((c) => (
            <li key={c.hex} className="flex items-center gap-2">
              <span aria-hidden className="size-2.5 border border-ink/10" style={{ backgroundColor: c.hex }} />
              <span className="capitalize text-ink">{c.name}</span>
              <span className="font-mono text-ink-muted">{c.hex.toUpperCase()}</span>
            </li>
          ))}
          <li className="ml-auto">
            <Link href={`/items/${item.id}`} className="inline-flex items-center gap-1 text-ink-muted hover:text-ink">
              Open <ArrowRight aria-hidden className="size-3" />
            </Link>
          </li>
        </ul>
      </div>
    </li>
  );
}
