"use client";

import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { EMPTY_FILTERS, hasActiveFilters, tagLabel, type GalleryFilters } from "@/lib/gallery-filters";
import { getLibrarySummary, getVocabulary } from "@/services/items";
import { FAMILY_SWATCH } from "@/lib/colour-families";
import { COLOR_FAMILIES, type ColorFamily, type SortOrder } from "@/types/api";

export const SEARCH_DEBOUNCE_MS = 300;

export function GalleryFilterBar({
  filters,
  onChange,
}: {
  filters: GalleryFilters;
  onChange: (next: GalleryFilters) => void;
}) {
  const summary = useQuery({ queryKey: ["items", "summary"], queryFn: getLibrarySummary });
  const vocabulary = useQuery({ queryKey: ["tags", "vocabulary"], queryFn: getVocabulary, staleTime: Infinity });

  // Debounced text search: typing updates the URL after a short pause.
  const [text, setText] = useState(filters.q);
  const [syncedQ, setSyncedQ] = useState(filters.q);
  if (filters.q !== syncedQ) {
    setSyncedQ(filters.q); // the URL changed elsewhere (back button, clear all)
    setText(filters.q);
  }
  useEffect(() => {
    if (text.trim() === filters.q.trim()) return;
    const timer = setTimeout(() => onChange({ ...filters, q: text }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, filters, onChange]);

  const [tagText, setTagText] = useState("");
  const tagListId = useId();
  const tagSuggestions = [
    ...(summary.data?.tags.map((t) => `${t.category}:${t.tag}`) ?? []),
    ...(vocabulary.data?.categories.flatMap((c) => c.tags.map((t) => `${c.category}:${t}`)) ?? []),
  ].filter((value, index, all) => all.indexOf(value) === index && !filters.tags.includes(value));

  const addTag = (event: FormEvent) => {
    event.preventDefault();
    const tag = tagText.trim().toLowerCase();
    if (tag && !filters.tags.includes(tag)) onChange({ ...filters, tags: [...filters.tags, tag] });
    setTagText("");
  };
  const toggleColor = (family: ColorFamily) =>
    onChange({
      ...filters,
      colors: filters.colors.includes(family)
        ? filters.colors.filter((c) => c !== family)
        : [...filters.colors, family],
    });

  const presentFamilies = new Map(summary.data?.color_families.map((f) => [f.family, f.items]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="relative min-w-56 flex-1">
          <span className="sr-only">Search your library</span>
          <Search aria-hidden className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={100}
            placeholder="Search tags, colours, notes… e.g. ikat, haldi, linen"
            className="w-full rounded-[2px] border border-line bg-paper-raised py-2.5 pl-9 pr-4 text-sm outline-none focus:border-ink"
          />
        </label>
        <label className="text-xs text-ink-muted">
          Sort
          <select
            value={filters.sort}
            onChange={(e) => onChange({ ...filters, sort: e.target.value as SortOrder })}
            className="mt-1 block rounded-[2px] border border-line bg-paper-raised px-3 py-2 text-sm text-ink"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="relevance" disabled={!filters.q.trim()}>
              Best match (with a search)
            </option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div role="group" aria-label="Filter by colour" className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-ink-muted">Colour</span>
          {COLOR_FAMILIES.map((family) => {
            const active = filters.colors.includes(family);
            const count = presentFamilies.get(family);
            return (
              <button
                key={family}
                type="button"
                aria-pressed={active}
                aria-label={`${family}${count ? ` (${count})` : ""}`}
                title={`${family}${count ? ` · ${count} pieces` : ""}`}
                onClick={() => toggleColor(family)}
                className={cn(
                  "size-6 border transition-transform",
                  active ? "scale-110 border-ink ring-2 ring-ink ring-offset-2 ring-offset-paper" : "border-ink/20",
                  !count && !active && "opacity-35",
                )}
                style={{ backgroundColor: FAMILY_SWATCH[family] }}
              />
            );
          })}
        </div>

        <form onSubmit={addTag} className="flex items-center gap-2" aria-label="Filter by tag">
          <label className="text-xs text-ink-muted">
            <span className="sr-only">Tag to filter by</span>
            <input
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              list={tagListId}
              placeholder="Filter by tag, e.g. craft:ikat"
              className="w-56 rounded-[2px] border border-line bg-paper-raised px-3 py-1.5 text-sm text-ink"
            />
          </label>
          <datalist id={tagListId}>
            {tagSuggestions.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
          <Button type="submit" variant="secondary" disabled={!tagText.trim()}>
            Add filter
          </Button>
        </form>
      </div>

      {hasActiveFilters(filters) && (
        <div role="group" className="flex flex-wrap items-center gap-2" aria-label="Active filters">
          {filters.q.trim() && (
            <ActiveChip label={`“${filters.q.trim()}”`} onRemove={() => onChange({ ...filters, q: "" })} />
          )}
          {filters.tags.map((tag) => (
            <ActiveChip
              key={tag}
              label={`Tag: ${tagLabel(tag)}`}
              onRemove={() => onChange({ ...filters, tags: filters.tags.filter((t) => t !== tag) })}
            />
          ))}
          {filters.colors.map((family) => (
            <ActiveChip key={family} label={`Colour: ${family}`} onRemove={() => toggleColor(family)} />
          ))}
          {filters.type && (
            <ActiveChip label={`Type: ${filters.type}`} onRemove={() => onChange({ ...filters, type: undefined })} />
          )}
          <button
            type="button"
            className="text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
            onClick={() => onChange({ ...EMPTY_FILTERS, sort: filters.sort === "relevance" ? "newest" : filters.sort })}
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

function ActiveChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[2px] bg-ink px-3 py-1 text-xs text-paper">
      {label}
      <button type="button" onClick={onRemove} aria-label={`Remove filter ${label}`} className="opacity-80 hover:opacity-100">
        <X aria-hidden className="size-3" />
      </button>
    </span>
  );
}
