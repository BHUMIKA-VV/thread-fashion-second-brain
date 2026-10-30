"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ProcessingBadge } from "@/components/processing-badge";
import { AddToCollection } from "@/features/collections/add-to-collection";
import { OwnerDeepAnalysis } from "@/features/deep-analysis/owner-deep-analysis";
import { PublishSwitch } from "@/features/showcase/publish-switch";
import { SwatchCardButton } from "@/features/swatch-card/swatch-card-button";
import { PaletteView } from "@/features/palette/palette-view";
import { SimilarPieces } from "@/features/similar/similar-pieces";
import { TagsPanel } from "@/features/tags/tags-panel";
import { Button, ButtonLink } from "@/components/ui/button";
import { ApiError, apiUrl } from "@/lib/api-client";
import { formatBytes } from "@/lib/upload-rules";
import { deleteItem, getItem, updateItem } from "@/services/items";
import { ITEM_TYPES, type Item, type ItemType } from "@/types/api";

export const ITEM_PROCESSING_POLL_MS = 4_000;

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function ItemDetail({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ["items", "detail", id],
    queryFn: () => getItem(id),
    // While analysis is still running (e.g. the model was loading at upload time), keep the
    // status badge honest by checking again until it settles.
    refetchInterval: (q) =>
      q.state.data && ["queued", "processing"].includes(q.state.data.processing_status)
        ? ITEM_PROCESSING_POLL_MS
        : false,
  });

  if (query.isPending) {
    return <div role="status" className="h-[60vh] animate-pulse rounded-[2px] bg-ink/[0.06]" aria-busy="true" aria-label="Loading item" />;
  }
  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div role="alert" className="rounded-[2px] border border-line bg-paper-raised p-10 text-center">
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

/** A short, stable reference for the piece, like a catalogue number. */
function recordNumber(id: string): string {
  return id.slice(0, 6).toUpperCase();
}

/** The piece's own words when it has notes (first sentence), otherwise its type. */
export function itemTitle(item: Item): string {
  const first = item.notes?.split(/(?<=[.!?])\s/)[0]?.trim();
  if (!first) return `Untitled ${item.type}`;
  return first.length > 80 ? `${first.slice(0, 77).trimEnd()}…` : first.replace(/[.]$/, "");
}

function ItemView({ item }: { item: Item }) {
  return (
    <div>
      <Link href="/gallery" className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" /> Archive
      </Link>
      <div className="mt-6 grid gap-10 lg:grid-cols-12 lg:gap-12">
        {/* The object itself: borderless, and held in view while the record scrolls. */}
        <figure className="self-start lg:sticky lg:top-8 lg:col-span-7">
          <div className="bg-paper-raised">
            {/* eslint-disable-next-line @next/next/no-img-element -- private image served by the API */}
            <img
              src={apiUrl(item.image_url)}
              alt={item.notes ? item.notes.slice(0, 120) : `${item.type} image`}
              width={item.width}
              height={item.height}
              className="h-auto w-full"
            />
          </div>
          <figcaption className="mt-3 text-xs text-ink-muted">
            <span className="font-display italic text-ink">Record {recordNumber(item.id)}</span> · {item.type}
          </figcaption>
        </figure>

        <div className="space-y-12 lg:col-span-5">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] uppercase tracking-[0.28em] text-ink-muted">
                {item.type} · Record {recordNumber(item.id)}
              </p>
              <ProcessingBadge status={item.processing_status} />
            </div>
            <h1 className="mt-3 text-balance font-display text-4xl leading-tight tracking-tight">{itemTitle(item)}</h1>
            <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-line pt-4 text-sm">
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
            <div className="mt-6">
              <PublishSwitch kind="item" id={item.id} isPublic={item.is_public} />
            </div>
          </div>

          <PaletteView item={item} />
          {item.palette && (
            <SwatchCardButton id={item.id} imageUrl={item.image_url} colours={item.palette.colors} type={item.type} />
          )}
          <TagsPanel item={item} />
          <OwnerDeepAnalysis itemId={item.id} />
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
    "mt-1.5 w-full rounded-[2px] border border-line bg-paper-raised px-3.5 py-2.5 text-sm outline-none focus:border-ink";

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-labelledby="details-title">
      <h2 id="details-title" className="border-t border-ink pt-5 font-display text-xl">
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
    <div role="alertdialog" aria-labelledby="delete-title" className="rounded-[2px] border border-danger/30 bg-danger/5 p-5">
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
