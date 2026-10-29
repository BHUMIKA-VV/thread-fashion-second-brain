"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlus } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { addToCollection, createCollection, listCollections, removeFromCollection } from "@/services/collections";
import type { CollectionSummary } from "@/types/api";

/** On the item page: tick the collections this piece belongs to, or start a new one. */
export function AddToCollection({ itemId }: { itemId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const key = ["collections", "for-item", itemId];
  const query = useQuery({ queryKey: key, queryFn: () => listCollections(itemId), enabled: open });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["collections"] });
  };

  // Set synchronously on click so the controlled checkbox never snaps back while the cache update
  // below is still awaiting; cleared once the cache holds the optimistic or rolled-back value.
  const [ticking, setTicking] = useState<Record<string, boolean>>({});
  const toggle = useMutation({
    mutationFn: ({ id, add }: { id: string; add: boolean }) =>
      add ? addToCollection(id, itemId) : removeFromCollection(id, itemId),
    // Tick the box at once; roll back if the server refuses.
    onMutate: async ({ id, add }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CollectionSummary[]>(key);
      queryClient.setQueryData<CollectionSummary[]>(key, (rows) =>
        rows?.map((row) =>
          row.id === id ? { ...row, contains_item: add, item_count: row.item_count + (add ? 1 : -1) } : row,
        ),
      );
      return { previous };
    },
    onError: (_error, _vars, context) => queryClient.setQueryData(key, context?.previous),
    onSettled: (_data, _error, { id }) => {
      setTicking((t) => {
        const rest = { ...t };
        delete rest[id];
        return rest;
      });
      refresh();
    },
  });
  const [name, setName] = useState("");
  const createAndAdd = useMutation({
    mutationFn: async () => {
      const created = await createCollection(name.trim());
      return addToCollection(created.id, itemId);
    },
    onSuccess: () => {
      setName("");
      refresh();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) createAndAdd.mutate();
  };
  const error = toggle.error ?? createAndAdd.error;

  return (
    <section aria-labelledby="collections-title" className="rounded-2xl border border-line bg-paper-raised p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="collections-title" className="font-display text-xl">
          Collections
        </h2>
        <Button variant="secondary" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <FolderPlus aria-hidden className="size-4" /> {open ? "Done" : "Add to collection"}
        </Button>
      </div>
      {open && (
        <div className="mt-4 space-y-4">
          {query.isPending ? (
            <p className="text-sm text-ink-muted">Loading collections…</p>
          ) : query.isError ? (
            <p role="alert" className="text-sm text-danger">
              Collections could not be loaded.
            </p>
          ) : query.data.length === 0 ? (
            <p className="text-sm text-ink-muted">You have no collections yet. Name one below.</p>
          ) : (
            <ul className="space-y-1.5" aria-label="Your collections">
              {query.data.map((collection) => (
                <li key={collection.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={ticking[collection.id] ?? Boolean(collection.contains_item)}
                      disabled={toggle.isPending}
                      onChange={(e) => {
                        const add = e.target.checked;
                        setTicking((t) => ({ ...t, [collection.id]: add }));
                        toggle.mutate({ id: collection.id, add });
                      }}
                    />
                    {collection.name}
                    <span className="text-xs text-ink-muted">({collection.item_count})</span>
                    <Link href={`/collections/${collection.id}`} className="ml-auto text-xs underline">
                      Open
                    </Link>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={submit} className="flex flex-wrap items-end gap-2" aria-label="New collection with this piece">
            <label className="min-w-40 flex-1 text-xs text-ink-muted">
              New collection
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                placeholder="e.g. Wedding guest ideas"
                className="mt-1 block w-full rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <Button type="submit" variant="secondary" disabled={!name.trim() || createAndAdd.isPending}>
              Create &amp; add
            </Button>
          </form>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error instanceof ApiError ? error.message : "That change could not be saved."}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
