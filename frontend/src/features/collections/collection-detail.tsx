"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button, ButtonLink } from "@/components/ui/button";
import { PaletteStrip } from "@/features/palette/palette-strip";
import { ApiError, apiUrl } from "@/lib/api-client";
import {
  deleteCollection,
  getCollection,
  removeFromCollection,
  updateCollection,
  updateCollectionItem,
} from "@/services/collections";
import type { CollectionDetail, CollectionEntry } from "@/types/api";

export function CollectionDetailView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const key = ["collections", "detail", id];
  const query = useQuery({ queryKey: key, queryFn: () => getCollection(id) });

  const onUpdated = (detail: CollectionDetail) => {
    queryClient.setQueryData(key, detail);
    void queryClient.invalidateQueries({ queryKey: ["collections"], exact: true });
  };
  const itemChange = useMutation({
    mutationFn: (change: { itemId: string; note?: string | null; position?: number; remove?: boolean }) =>
      change.remove
        ? removeFromCollection(id, change.itemId)
        : updateCollectionItem(id, change.itemId, { note: change.note, position: change.position }),
    onSuccess: onUpdated,
  });

  if (query.isPending) {
    return <div className="h-[50vh] animate-pulse rounded-2xl bg-ink/[0.06]" aria-label="Loading collection" />;
  }
  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div role="alert" className="rounded-2xl border border-line bg-paper-raised p-10 text-center">
        <p className="font-display text-2xl">{missing ? "This collection doesn't exist" : "Couldn't load this collection"}</p>
        <ButtonLink href="/collections" variant="secondary" className="mt-6">
          All collections
        </ButtonLink>
      </div>
    );
  }

  const detail = query.data;
  const last = detail.items.length - 1;
  return (
    <div>
      <Link href="/collections" className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" /> Collections
      </Link>
      <DetailsForm detail={detail} onUpdated={onUpdated} />

      {itemChange.isError && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {itemChange.error instanceof ApiError ? itemChange.error.message : "That change could not be saved."}
        </p>
      )}

      {detail.items.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-dashed border-ink/20 px-6 py-14 text-center text-sm text-ink-muted">
          This collection is empty. Open any piece and use “Add to collection”.{" "}
          <Link href="/gallery" className="underline">
            Browse the gallery
          </Link>
        </p>
      ) : (
        <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Pieces in this collection">
          {detail.items.map((entry, index) => (
            <li key={entry.item.id}>
              <EntryCard
                entry={entry}
                isFirst={index === 0}
                isLast={index === last}
                busy={itemChange.isPending}
                onMove={(position) => itemChange.mutate({ itemId: entry.item.id, position })}
                onNote={(note) => itemChange.mutate({ itemId: entry.item.id, note })}
                onRemove={() => itemChange.mutate({ itemId: entry.item.id, remove: true })}
              />
            </li>
          ))}
        </ol>
      )}

      <DeleteCollection detail={detail} />
    </div>
  );
}

function DetailsForm({ detail, onUpdated }: { detail: CollectionDetail; onUpdated: (d: CollectionDetail) => void }) {
  const [name, setName] = useState(detail.name);
  const [description, setDescription] = useState(detail.description ?? "");
  const save = useMutation({
    mutationFn: () => updateCollection(detail.id, { name: name.trim(), description: description.trim() || null }),
    onSuccess: onUpdated,
  });
  const dirty = name.trim() !== detail.name || (description.trim() || null) !== detail.description;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() && dirty) save.mutate();
  };

  return (
    <form onSubmit={submit} aria-label="Collection details" className="mt-6 space-y-3">
      <h1 className="sr-only">{detail.name}</h1>
      <label className="block">
        <span className="sr-only">Collection name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="w-full bg-transparent font-display text-4xl tracking-tight outline-none focus:underline"
        />
      </label>
      <label className="block">
        <span className="sr-only">Description</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={2}
          placeholder="Add a description…"
          className="w-full max-w-2xl resize-y bg-transparent text-ink-muted outline-none focus:text-ink"
        />
      </label>
      <div className="flex items-center gap-3" aria-live="polite">
        <Button type="submit" variant="secondary" disabled={!dirty || !name.trim() || save.isPending}>
          {save.isPending ? "Saving…" : "Save details"}
        </Button>
        {save.isError && (
          <span role="alert" className="text-sm text-danger">
            {save.error instanceof ApiError ? save.error.message : "Could not save."}
          </span>
        )}
      </div>
    </form>
  );
}

function EntryCard({
  entry,
  isFirst,
  isLast,
  busy,
  onMove,
  onNote,
  onRemove,
}: {
  entry: CollectionEntry;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  onMove: (position: number) => void;
  onNote: (note: string | null) => void;
  onRemove: () => void;
}) {
  const [note, setNote] = useState(entry.note ?? "");
  const { item } = entry;
  const label = item.notes ? item.notes.slice(0, 60) : `${item.type} image`;
  return (
    <article className="overflow-hidden rounded-xl border border-line bg-paper-raised shadow-soft" aria-label={label}>
      <Link href={`/items/${item.id}`} className="block aspect-[3/4] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- private image served by the API */}
        <img src={apiUrl(item.thumbnail_url)} alt={label} className="size-full object-cover" />
      </Link>
      {item.palette && <PaletteStrip colors={item.palette.colors} />}
      <div className="space-y-2 p-3">
        <label className="block text-xs text-ink-muted">
          Note in this collection
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              if ((note.trim() || null) !== entry.note) onNote(note.trim() || null);
            }}
            maxLength={2000}
            rows={2}
            placeholder="Why it belongs here…"
            className="mt-1 block w-full resize-y rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink"
          />
        </label>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            disabled={isFirst || busy}
            onClick={() => onMove(entry.position - 1)}
            aria-label={`Move ${label} earlier`}
          >
            <ArrowLeft aria-hidden className="size-4" /> Earlier
          </Button>
          <Button
            variant="ghost"
            disabled={isLast || busy}
            onClick={() => onMove(entry.position + 1)}
            aria-label={`Move ${label} later`}
          >
            Later <ArrowRight aria-hidden className="size-4" />
          </Button>
          <Button
            variant="ghost"
            className="ml-auto text-danger"
            disabled={busy}
            onClick={onRemove}
            aria-label={`Remove ${label} from this collection`}
          >
            <X aria-hidden className="size-4" />
          </Button>
        </div>
      </div>
    </article>
  );
}

function DeleteCollection({ detail }: { detail: CollectionDetail }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => deleteCollection(detail.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["collections", "detail", detail.id] });
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
      void queryClient.invalidateQueries({ queryKey: ["items", "summary"] });
      router.push("/collections");
    },
  });

  return (
    <div className="mt-14 border-t border-line pt-6">
      {!confirming ? (
        <Button variant="ghost" className="text-danger" onClick={() => setConfirming(true)}>
          <Trash2 aria-hidden className="size-4" /> Delete collection
        </Button>
      ) : (
        <div role="alertdialog" aria-labelledby="delete-collection-title" className="rounded-2xl border border-danger/30 bg-danger/5 p-5">
          <p id="delete-collection-title" className="text-sm">
            Delete “{detail.name}”? The {detail.items.length}{" "}
            {detail.items.length === 1 ? "piece stays" : "pieces stay"} in your library; only the
            collection is removed.
          </p>
          <div className="mt-4 flex gap-3">
            <Button className="bg-danger text-paper hover:bg-danger/90" onClick={() => remove.mutate()} disabled={remove.isPending} autoFocus>
              {remove.isPending ? "Deleting…" : "Delete collection"}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={remove.isPending}>
              Cancel
            </Button>
          </div>
          {remove.isError && (
            <p role="alert" className="mt-3 text-sm text-danger">
              The collection could not be deleted.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
