"use client";

import { useQuery } from "@tanstack/react-query";

import { ButtonLink } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { getBoard } from "@/services/boards";
import { getCollection } from "@/services/collections";

import { Presenter } from "./presenter";
import { boardSlides, collectionSlides } from "./slides";

function Problem({ error, what, back }: { error: unknown; what: string; back: { href: string; label: string } }) {
  const missing = error instanceof ApiError && error.status === 404;
  return (
    <div role="alert" className="mx-auto max-w-xl rounded-[2px] border border-line bg-paper-raised p-10 text-center">
      <p className="font-display text-2xl">{missing ? `This ${what} doesn't exist` : `Couldn't load this ${what}`}</p>
      <ButtonLink href={back.href} variant="secondary" className="mt-6">
        {back.label}
      </ButtonLink>
    </div>
  );
}

const loading = <div role="status" aria-label="Loading the presentation" className="h-[50vh] animate-pulse bg-ink/[0.05]" />;

export function BoardPresentation({ id }: { id: string }) {
  const query = useQuery({ queryKey: ["boards", "detail", id], queryFn: () => getBoard(id) });
  if (query.isPending) return loading;
  if (query.isError) return <Problem error={query.error} what="board" back={{ href: "/boards", label: "All boards" }} />;
  return <Presenter slides={boardSlides(query.data)} exitHref={`/boards/${id}`} name={query.data.name} />;
}

export function CollectionPresentation({ id }: { id: string }) {
  const query = useQuery({ queryKey: ["collections", "detail", id], queryFn: () => getCollection(id) });
  if (query.isPending) return loading;
  if (query.isError) {
    return <Problem error={query.error} what="collection" back={{ href: "/collections", label: "All collections" }} />;
  }
  return <Presenter slides={collectionSlides(query.data)} exitHref={`/collections/${id}`} name={query.data.name} />;
}
