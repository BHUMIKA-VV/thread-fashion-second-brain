"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ProcessingBadge } from "@/components/processing-badge";
import { AddToCollection } from "@/features/collections/add-to-collection";
import { PaletteView } from "@/features/palette/palette-view";
import { SimilarPieces } from "@/features/similar/similar-pieces";
import { TagsPanel } from "@/features/tags/tags-panel";
import { Button, ButtonLink } from "@/components/ui/button";
import { ApiError, apiUrl } from "@/lib/api-client";
import { formatBytes } from "@/lib/upload-rules";
import { deleteItem, getItem, updateItem } from "@/services/items";
import { ITEM_TYPES, type Item, type ItemType } from "@/types/api";

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function ItemDetail({ id }: { id: string }) {
  const query = useQuery({ queryKey: ["items", "detail", id], queryFn: () => getItem(id) });

  if (query.isPending) {
    return <div className="h-[60vh] animate-pulse rounded-2xl bg-ink/[0.06]" aria-busy="true" aria-label="Loading item" />;
  }
  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div role="alert" className="rounded-2xl border border-line bg-paper-raised p-10 text-center">
        <p className="font-display text-2xl">{missing ? "This item doesn't exist" : "Couldn't load this item"}</p>
        <p className="mt-2 text-sm text-ink-muted">
          {missing ? "It may have been deleted." : query.error.message}
        </p>
        <ButtonLink href="/gallery" variant="secondary" className="mt-6">
          Back to gallery
        </ButtonLink>
      </div>
    );
  }
  return <ItemView item={query.data} />;
}

function ItemView({ item }: { item: Item }) {
  return (
    <div>
      <Link href="/gallery" className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" /> Gallery
      </Link>
      <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <figure className="overflow-hidden rounded-2xl border border-line bg-paper-raised shadow-soft">
          {/* eslint-disable-next-line @next/next/no-img-element -- private image served by the API */}
          <img
            src={apiUrl(item.image_url)}
            alt={item.notes ? item.notes.slice(0, 120) : `${item.type} image`}
            width={item.width}
            height={item.height}
            className="h-auto w-full"
          />
        </figure>

        <div className="space-y-8">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.3em] text-ink-muted">{item.type}</p>
              <ProcessingBadge status={item.processing_status} />
            </div>
            <h1 className="mt-2 font-display text-3xl tracking-tight">Saved piece</h1>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <dt className="text-ink-muted">Added</dt>
              <dd>{dateFormat.format(new Date(item.created_at))}</dd>
              <dt className="text-ink-muted">Dimensions</dt>
              <dd>
                {item.width} × {item.height}px
              </dd>
              <dt className="text-ink-muted">File</dt>
              <dd>
                {item.mime_type.replace("image/", "").toUpperCase()} · {formatBytes(item.file_size)}
              </dd>
            </dl>
          </div>

          <PaletteView item={item} />
          <TagsPanel item={item} />
          <AddToCollection itemId={item.id} />
          <EditForm item={item} />
          <DeleteControl item={item} />
        </div>
      </div>

      <SimilarPieces itemId={item.id} />
    </div>
  );
}

function EditForm({ item }: { item: Item }) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<ItemType>(item.type);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [sourceUrl, setSourceUrl] = useState(item.source_url ?? "");

  const mutation = useMutation({
    mutationFn: () =>
      updateItem(item.id, {
        type,
        notes: notes.trim() || null,
        source_url: sourceUrl.trim() || null,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["items", "detail", item.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["items"], exact: false });
    },
  });

  const dirty =
    type !== item.type || notes !== (item.notes ?? "") || sourceUrl !== (item.source_url ?? "");

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  const fieldClass =
    "mt-1.5 w-full rounded-xl border border-line bg-paper-raised px-3.5 py-2.5 text-sm outline-none focus:border-ink";

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-labelledby="details-title">
      <h2 id="details-title" className="font-display text-xl">
        Details
      </h2>
      <label className="block text-sm">
        Type
        <select value={type} onChange={(e) => setType(e.target.value as ItemType)} className={fieldClass}>
          {ITEM_TYPES.map((value) => (
            <option key={value} value={value}>
              {value[0].toUpperCase() + value.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Notes
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          maxLength={5000}
          placeholder="Where you saw it, what you love about it…"
          className={fieldClass}
        />
      </label>
      <label className="block text-sm">
        Source URL
        <input
          type="url"
          inputMode="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://"
          className={fieldClass}
        />
      </label>
      {item.source_url && (
        <a
          href={item.source_url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex items-center gap-1.5 text-xs text-ink-muted underline underline-offset-2"
        >
          Open source <ExternalLink aria-hidden className="size-3" />
        </a>
      )}
      <div className="flex items-center gap-3" aria-live="polite">
        <Button type="submit" disabled={!dirty || mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save changes"}
        </Button>
        {mutation.isSuccess && !dirty && <span className="text-sm text-success">Saved</span>}
        {mutation.isError && (
          <span role="alert" className="text-sm text-danger">
            {mutation.error instanceof ApiError && mutation.error.code === "validation_error"
              ? "Check the source URL (http or https) and try again."
              : mutation.error.message}
          </span>
        )}
      </div>
    </form>
  );
}

function DeleteControl({ item }: { item: Item }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const mutation = useMutation({
    mutationFn: () => deleteItem(item.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["items", "detail", item.id] });
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      router.push("/gallery");
    },
  });

  if (!confirming) {
    return (
      <Button variant="ghost" className="text-danger" onClick={() => setConfirming(true)}>
        <Trash2 aria-hidden className="size-4" /> Delete item
      </Button>
    );
  }
  return (
    <div role="alertdialog" aria-labelledby="delete-title" className="rounded-2xl border border-danger/30 bg-danger/5 p-5">
      <p id="delete-title" className="text-sm">
        Delete this image and its notes permanently? This cannot be undone.
      </p>
      <div className="mt-4 flex gap-3">
        <Button
          className="bg-danger text-paper hover:bg-danger/90"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          autoFocus
        >
          {mutation.isPending ? "Deleting…" : "Delete permanently"}
        </Button>
        <Button variant="secondary" onClick={() => setConfirming(false)} disabled={mutation.isPending}>
          Cancel
        </Button>
      </div>
      {mutation.isError && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {mutation.error.message}
        </p>
      )}
    </div>
  );
}
