"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { ButtonLink } from "@/components/ui/button";
import { SwatchCardButton } from "@/features/swatch-card/swatch-card-button";
import { apiUrl, ApiError } from "@/lib/api-client";
import { getShowcaseItem, getShowcaseSimilar } from "@/services/showcase";
import type { ShowcaseItemDetail } from "@/types/api";

import { recordNumber, ShowcaseTile } from "./showcase-tile";

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "long" });

export function ShowcasePiece({ id }: { id: string }) {
  const piece = useQuery({ queryKey: ["showcase", "item", id], queryFn: () => getShowcaseItem(id) });
  if (piece.isPending) return <div role="status" aria-label="Loading the piece" className="h-[60vh] animate-pulse bg-ink/[0.05]" />;
  if (piece.isError) {
    const missing = piece.error instanceof ApiError && piece.error.status === 404;
    return (
      <div role="alert" className="border-y border-line py-16 text-center">
        <p className="font-display text-2xl">{missing ? "This piece isn't in the showcase" : "This piece could not be loaded."}</p>
        <p className="mt-2 text-sm text-ink-muted">{missing ? "It may have been made private." : piece.error.message}</p>
        <ButtonLink href="/showcase" variant="secondary" className="mt-6">
          Back to the showcase
        </ButtonLink>
      </div>
    );
  }
  return <PieceView item={piece.data} />;
}

function PieceView({ item }: { item: ShowcaseItemDetail }) {
  const colours = item.palette?.colors ?? [];
  const byCategory = item.tags.reduce<Record<string, string[]>>((acc, t) => {
    (acc[t.category] ??= []).push(t.tag);
    return acc;
  }, {});
  return (
    <div>
      <Link href="/showcase" className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" /> Showcase
      </Link>
      <div className="mt-6 grid gap-10 lg:grid-cols-12 lg:gap-12">
        <figure className="self-start lg:sticky lg:top-8 lg:col-span-7">
          <div className="bg-paper-raised">
            {/* eslint-disable-next-line @next/next/no-img-element -- served by the API */}
            <img
              src={apiUrl(item.image_url)}
              alt={`${item.type}${colours.length ? ` in ${colours.slice(0, 2).map((c) => c.name).join(" and ")}` : ""}`}
              width={item.width}
              height={item.height}
              className="h-auto w-full"
            />
          </div>
          <figcaption className="mt-3 text-xs text-ink-muted">
            <span className="font-display italic text-ink">Record {recordNumber(item.id)}</span> · {item.type}
          </figcaption>
        </figure>

        <div className="space-y-10 lg:col-span-5">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-ink-muted">
              {item.type} · Record {recordNumber(item.id)}
            </p>
            <h1 className="mt-3 font-display text-4xl capitalize leading-tight tracking-tight">
              {colours[0] ? `${colours[0].name} ${item.type}` : `A ${item.type}`}
            </h1>
            <p className="mt-3 text-sm text-ink-muted">Added {dateFormat.format(new Date(item.created_at))}</p>
          </div>

          {colours.length > 0 && (
            <section aria-labelledby="palette-title" className="border-t border-ink pt-5">
              <h2 id="palette-title" className="font-display text-xl">
                Palette
              </h2>
              <div
                className="mt-4 flex h-14 overflow-hidden"
                role="img"
                aria-label={`Palette: ${colours.map((c) => `${c.name} ${Math.round(c.percentage)}%`).join(", ")}`}
              >
                {colours.map((c) => (
                  <span key={c.hex} style={{ backgroundColor: c.hex, width: `${c.percentage}%` }} />
                ))}
              </div>
              <ul className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                {colours.map((c) => (
                  <li key={c.hex} className="flex items-center gap-3">
                    <span aria-hidden className="size-4 shrink-0 border border-ink/10" style={{ backgroundColor: c.hex }} />
                    <span className="capitalize">{c.name}</span>
                    <span className="ml-auto font-mono text-xs text-ink-muted">
                      {c.hex.toUpperCase()} · {Math.round(c.percentage)}%
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                <SwatchCardButton id={item.id} imageUrl={item.image_url} colours={colours} type={item.type} />
              </div>
            </section>
          )}

          {item.tags.length > 0 && (
            <section aria-labelledby="tags-title" className="border-t border-ink pt-5">
              <h2 id="tags-title" className="font-display text-xl">
                Craft &amp; form
              </h2>
              <dl className="mt-4 space-y-3 text-sm">
                {Object.entries(byCategory).map(([category, tags]) => (
                  <div key={category} className="grid grid-cols-[7rem_1fr] gap-3">
                    <dt className="capitalize text-ink-muted">{category}</dt>
                    <dd>{tags.join(", ")}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-xs text-ink-muted">Tags are suggested by an image model and may be wrong.</p>
            </section>
          )}
        </div>
      </div>
      <SimilarPublished id={item.id} />
    </div>
  );
}

function SimilarPublished({ id }: { id: string }) {
  const similar = useQuery({ queryKey: ["showcase", "similar", id], queryFn: () => getShowcaseSimilar(id) });
  if (!similar.data || similar.data.results.length === 0) return null;
  return (
    <section aria-labelledby="kindred-title" className="mt-20 border-t border-ink pt-5">
      <h2 id="kindred-title" className="font-display text-2xl">
        Kindred pieces
      </h2>
      <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4">
        {similar.data.results.slice(0, 8).map((r) => (
          <li key={r.item.id}>
            <ShowcaseTile item={r.item} />
          </li>
        ))}
      </ul>
    </section>
  );
}
