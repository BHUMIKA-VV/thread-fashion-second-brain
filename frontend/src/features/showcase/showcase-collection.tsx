"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { ButtonLink } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { getShowcaseCollection } from "@/services/showcase";

import { ShowcaseTile } from "./showcase-tile";

export function ShowcaseCollectionView({ id }: { id: string }) {
  const collection = useQuery({ queryKey: ["showcase", "collection", id], queryFn: () => getShowcaseCollection(id) });
  if (collection.isPending) return <div role="status" aria-label="Loading the collection" className="h-[50vh] animate-pulse bg-ink/[0.05]" />;
  if (collection.isError) {
    const missing = collection.error instanceof ApiError && collection.error.status === 404;
    return (
      <div role="alert" className="border-y border-line py-16 text-center">
        <p className="font-display text-2xl">{missing ? "This collection isn't in the showcase" : "This collection could not be loaded."}</p>
        <ButtonLink href="/showcase" variant="secondary" className="mt-6">
          Back to the showcase
        </ButtonLink>
      </div>
    );
  }
  const { name, description, items, total } = collection.data;
  return (
    <div>
      <Link href="/showcase" className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" /> Showcase
      </Link>
      <header className="mt-6 border-b border-line pb-8">
        <p className="text-[11px] uppercase tracking-[0.28em] text-ink-muted">
          Collection · {total} {total === 1 ? "piece" : "pieces"}
        </p>
        <h1 className="mt-4 font-display text-5xl leading-none tracking-tight sm:text-6xl">{name}</h1>
        {description && <p className="mt-4 max-w-2xl text-ink-muted">{description}</p>}
      </header>
      {items.length === 0 ? (
        <p className="py-16 text-center text-ink-muted">No published pieces in this collection yet.</p>
      ) : (
        <ul aria-label="Pieces in this collection" className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <li key={item.id}>
              <ShowcaseTile item={item} />
            </li>
          ))}
        </ul>
      )}
      {total > items.length && (
        <p className="mt-10 text-center text-sm text-ink-muted">
          Showing the first {items.length} of {total} pieces.
        </p>
      )}
    </div>
  );
}
