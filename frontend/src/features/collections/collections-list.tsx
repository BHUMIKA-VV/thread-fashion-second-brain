"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlus } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ApiError, apiUrl } from "@/lib/api-client";
import { createCollection, listCollections } from "@/services/collections";
import type { CollectionSummary } from "@/types/api";

export function CollectionsList() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["collections"], queryFn: () => listCollections() });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useMutation({
    mutationFn: () => createCollection(name.trim(), description.trim() || undefined),
    onSuccess: () => {
      setName("");
      setDescription("");
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
      void queryClient.invalidateQueries({ queryKey: ["items", "summary"] });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) create.mutate();
  };

  return (
    <div className="space-y-10">
      <form
        onSubmit={submit}
        aria-label="New collection"
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-paper-raised p-5"
      >
        <label className="min-w-48 flex-1 text-xs text-ink-muted">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="e.g. Summer linen"
            className="mt-1 block w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
          />
        </label>
        <label className="min-w-48 flex-[2] text-xs text-ink-muted">
          Description (optional)
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            className="mt-1 block w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
          />
        </label>
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          <FolderPlus aria-hidden className="size-4" /> {create.isPending ? "Creating…" : "Create collection"}
        </Button>
        {create.isError && (
          <p role="alert" className="w-full text-sm text-danger">
            {create.error instanceof ApiError ? create.error.message : "The collection could not be created."}
          </p>
        )}
      </form>

      {query.isPending ? (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading collections">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-64 animate-pulse rounded-2xl bg-ink/[0.06]" />
          ))}
        </ul>
      ) : query.isError ? (
        <div role="alert" className="text-sm text-danger">
          Collections could not be loaded.{" "}
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      ) : query.data.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-ink/20 px-6 py-14 text-center text-sm text-ink-muted">
          No collections yet. Create one above, then add pieces from any item page.
        </p>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Your collections">
          {query.data.map((collection) => (
            <li key={collection.id}>
              <CollectionCard collection={collection} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CollectionCard({ collection }: { collection: CollectionSummary }) {
  const covers = collection.cover_thumbnails;
  return (
    <Link
      href={`/collections/${collection.id}`}
      className="group block overflow-hidden rounded-2xl border border-line bg-paper-raised shadow-soft"
    >
      <div className="grid aspect-[4/3] grid-cols-2 grid-rows-2 gap-0.5 bg-line">
        {[0, 1, 2, 3].map((i) =>
          covers[i] ? (
            // eslint-disable-next-line @next/next/no-img-element -- private image served by the API
            <img key={i} src={apiUrl(covers[i])} alt="" className="size-full object-cover" />
          ) : (
            <span key={i} className="bg-paper" />
          ),
        )}
      </div>
      <div className="p-4">
        <p className="font-display text-xl group-hover:underline">{collection.name}</p>
        <p className="mt-1 text-xs text-ink-muted">
          {collection.item_count} {collection.item_count === 1 ? "piece" : "pieces"}
        </p>
        {collection.description && (
          <p className="mt-2 line-clamp-2 text-sm text-ink-muted">{collection.description}</p>
        )}
      </div>
    </Link>
  );
}
