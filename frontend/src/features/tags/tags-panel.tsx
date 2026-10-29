"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, RotateCcw, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { editItemTags, getItemTags, getTagScores, getVocabulary, reanalyzeItem } from "@/services/items";
import { TAG_CATEGORIES, type Item, type ItemTag, type ItemTags, type TagCategory, type TagEdit } from "@/types/api";

const CATEGORY_LABEL: Record<TagCategory, string> = {
  garment: "Garment",
  silhouette: "Silhouette",
  pattern: "Pattern",
  fabric: "Fabric (guess)",
  aesthetic: "Aesthetic",
  occasion: "Occasion",
  craft: "Craft",
};

export const TAGS_PENDING_RETRY_MS = 4_000;

export function TagsPanel({ item }: { item: Item }) {
  const queryClient = useQueryClient();
  const tagsKey = ["items", "tags", item.id];
  const query = useQuery({
    queryKey: tagsKey,
    queryFn: () => getItemTags(item.id),
    // While the model loads, AI tags are "pending": check again until they arrive.
    refetchInterval: (q) => (q.state.data?.status === "pending" ? TAGS_PENDING_RETRY_MS : false),
  });
  const [showScores, setShowScores] = useState(false);

  const edits = useMutation({
    mutationFn: (change: { add?: TagEdit[]; remove?: TagEdit[] }) => editItemTags(item.id, change),
    onSuccess: (updated) => {
      queryClient.setQueryData(tagsKey, updated);
      void queryClient.invalidateQueries({ queryKey: ["items", "similar", item.id] });
    },
  });
  const reanalysis = useMutation({
    mutationFn: () => reanalyzeItem(item.id),
    onSuccess: (updated) => {
      queryClient.setQueryData(["items", "detail", item.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["items"] });
    },
  });

  return (
    <section aria-labelledby="tags-title" className="border-t border-ink pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="tags-title" className="font-display text-xl">
          Tags
        </h2>
        <Button
          variant="ghost"
          onClick={() => reanalysis.mutate()}
          disabled={reanalysis.isPending}
          aria-label="Re-analyse this image"
        >
          <RefreshCw aria-hidden className={cn("size-4", reanalysis.isPending && "animate-spin")} />
          {reanalysis.isPending ? "Re-analysing…" : "Re-analyse"}
        </Button>
      </div>

      <div className="mt-3" aria-live="polite" aria-busy={query.isPending}>
        {query.isPending ? (
          <div role="status" className="h-16 animate-pulse rounded-[2px] bg-ink/[0.06]" aria-label="Loading tags" />
        ) : query.isError ? (
          <div role="alert" className="text-sm text-danger">
            Tags could not be loaded.{" "}
            <button type="button" className="underline" onClick={() => void query.refetch()}>
              Try again
            </button>
          </div>
        ) : (
          <TagList
            data={query.data}
            busy={edits.isPending}
            onRemove={(tag) => edits.mutate({ remove: [{ category: tag.category, tag: tag.tag }] })}
            onRestore={(tag) => edits.mutate({ add: [{ category: tag.category, tag: tag.tag }] })}
          />
        )}
      </div>

      {query.data?.suggested_type && query.data.suggested_type !== item.type && (
        <p className="mt-3 text-xs text-ink-muted">
          The model thinks this looks like a <strong>{query.data.suggested_type}</strong> image (a
          suggestion; your chosen type is kept).
        </p>
      )}

      <AddTagForm busy={edits.isPending} onAdd={(edit) => edits.mutateAsync({ add: [edit] })} />

      {(edits.isError || reanalysis.isError) && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {(edits.error ?? reanalysis.error) instanceof ApiError
            ? (edits.error ?? reanalysis.error)!.message
            : "That change could not be saved."}
        </p>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <button
          type="button"
          className="text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
          aria-expanded={showScores}
          onClick={() => setShowScores((open) => !open)}
        >
          {showScores ? "Hide all scores" : "Show all scores"}
        </button>
        {showScores && <AllScores itemId={item.id} />}
      </div>
    </section>
  );
}

function TagList({
  data,
  busy,
  onRemove,
  onRestore,
}: {
  data: ItemTags;
  busy: boolean;
  onRemove: (tag: ItemTag) => void;
  onRestore: (tag: ItemTag) => void;
}) {
  const statusNote = {
    completed: null,
    pending: "AI tags will appear once the image model has loaded.",
    unavailable: "AI tags need the image model, which is not installed. You can still add tags.",
    failed: "AI tags could not be generated for this image. You can still add tags.",
  }[data.status];

  const byCategory = TAG_CATEGORIES.map((category) => ({
    category,
    tags: data.tags.filter((t) => t.category === category),
  })).filter((group) => group.tags.length > 0);

  return (
    <div className="space-y-3">
      {statusNote && <p className="text-sm text-ink-muted">{statusNote}</p>}
      {byCategory.length === 0 && data.status === "completed" && (
        <p className="text-sm text-ink-muted">
          No tag cleared the confidence thresholds. Add your own, or see all scores below.
        </p>
      )}
      {byCategory.map(({ category, tags }) => (
        <div key={category}>
          <h3 className="text-xs uppercase tracking-[0.18em] text-ink-muted">{CATEGORY_LABEL[category]}</h3>
          <ul className="mt-1.5 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <li key={`${tag.category}:${tag.tag}`}>
                <TagChip tag={tag} disabled={busy} onRemove={() => onRemove(tag)} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      {data.removed.length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-[0.18em] text-ink-muted">Removed AI tags</h3>
          <ul className="mt-1.5 flex flex-wrap gap-2">
            {data.removed.map((tag) => (
              <li key={`${tag.category}:${tag.tag}`}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRestore(tag)}
                  aria-label={`Restore ${tag.tag}`}
                  className="inline-flex items-center gap-1.5 rounded-[2px] border border-dashed border-ink/25 px-3 py-1 text-xs text-ink-muted line-through hover:text-ink"
                >
                  {tag.tag} <RotateCcw aria-hidden className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TagChip({ tag, disabled, onRemove }: { tag: ItemTag; disabled: boolean; onRemove: () => void }) {
  const origin = tag.source === "ai" ? "AI" : tag.custom ? "custom" : "added by you";
  const title =
    tag.source === "ai" && tag.score != null
      ? `AI model score ${tag.score.toFixed(2)} (relative, uncalibrated)${tag.is_guess ? " · a guess from the photo" : ""}${tag.outdated ? " · from an older analysis" : ""}`
      : origin;
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-2 rounded-[2px] border px-3 py-1 text-sm",
        tag.source === "ai" ? "border-line bg-paper" : "border-clay/40 bg-clay/5",
        tag.outdated && "opacity-60",
      )}
    >
      <span>{tag.tag}</span>
      {tag.source === "ai" && tag.score != null && (
        <span
          aria-hidden
          className="h-1 w-8 overflow-hidden rounded-full bg-ink/10"
        >
          <span className="block h-full bg-ink/50" style={{ width: `${Math.round(tag.score * 100)}%` }} />
        </span>
      )}
      <span className="text-[10px] uppercase tracking-wider text-ink-muted">{origin}</span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${tag.tag}`}
        className="text-ink-muted hover:text-danger"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </span>
  );
}

function AddTagForm({ busy, onAdd }: { busy: boolean; onAdd: (edit: TagEdit) => Promise<unknown> }) {
  const vocabulary = useQuery({ queryKey: ["tags", "vocabulary"], queryFn: getVocabulary, staleTime: Infinity });
  const [category, setCategory] = useState<TagCategory>("craft");
  const [text, setText] = useState("");
  const listId = useId();
  const suggestions = vocabulary.data?.categories.find((c) => c.category === category)?.tags ?? [];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    try {
      await onAdd({ category, tag: text });
      setText("");
    } catch {
      // the panel shows the server's validation message
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-4 flex flex-wrap items-end gap-2" aria-label="Add a tag">
      <label className="text-xs text-ink-muted">
        Category
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as TagCategory)}
          className="mt-1 block rounded-[2px] border border-line bg-paper px-2 py-1.5 text-sm text-ink"
        >
          {TAG_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-40 flex-1 text-xs text-ink-muted">
        Tag
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          list={listId}
          maxLength={40}
          placeholder="e.g. ikat, or your own"
          className="mt-1 block w-full rounded-[2px] border border-line bg-paper px-2 py-1.5 text-sm text-ink"
        />
        <datalist id={listId}>
          {suggestions.map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>
      </label>
      <Button type="submit" variant="secondary" disabled={busy || !text.trim()}>
        <Plus aria-hidden className="size-4" /> Add tag
      </Button>
    </form>
  );
}

function AllScores({ itemId }: { itemId: string }) {
  const query = useQuery({ queryKey: ["items", "tag-scores", itemId], queryFn: () => getTagScores(itemId), retry: false });
  if (query.isPending) return <p className="mt-2 text-xs text-ink-muted">Loading scores…</p>;
  if (query.isError) {
    return (
      <p role="alert" className="mt-2 text-xs text-ink-muted">
        {query.error instanceof ApiError ? query.error.message : "Scores could not be loaded."}
      </p>
    );
  }
  return (
    <div className="mt-3 space-y-4">
      <p className="text-xs text-ink-muted">{query.data.note}</p>
      {query.data.categories.map((category) => (
        <div key={category.category}>
          <h3 className="text-xs uppercase tracking-[0.18em] text-ink-muted">
            {CATEGORY_LABEL[category.category]}{" "}
            <span className="normal-case tracking-normal">
              (shown if ≥ {category.min_score.toFixed(2)} and ahead of the next by{" "}
              {category.min_margin.toFixed(2)})
            </span>
          </h3>
          <ul className="mt-1 space-y-1" aria-label={`${CATEGORY_LABEL[category.category]} scores`}>
            {category.labels.map((label) => (
              <li key={label.tag} className="flex items-center gap-2 text-xs">
                <span className={cn("w-32 truncate", label.none && "italic text-ink-muted")}>
                  {label.none ? "none of these" : label.tag}
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/10">
                  <span
                    className={cn("block h-full", label.passes ? "bg-success" : "bg-ink/40")}
                    style={{ width: `${Math.max(1, Math.round(label.score * 100))}%` }}
                  />
                </span>
                <span className="w-10 text-right font-mono">{label.score.toFixed(2)}</span>
                <span className="sr-only">{label.passes ? "shown as a tag" : "below threshold"}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
