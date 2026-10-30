"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { getVocabulary } from "@/services/items";
import type { OutfitDetail, OutfitSeason, OutfitUpdate } from "@/types/api";

import { SEASON_NAMES } from "./names";

export const DETAILS_FORM_ID = "outfit-details";

const field = "mt-1 block w-full rounded-[2px] border border-line bg-paper-raised px-3 py-2 text-sm text-ink";

function parseTags(text: string): string[] {
  return text
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/** Mount with `key={outfit.id}`. Saved with the toolbar's Save button. */
export function OutfitDetailsForm({
  outfit,
  onSave,
  onDirtyChange,
}: {
  outfit: OutfitDetail;
  onSave: (changes: OutfitUpdate) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const vocabulary = useQuery({ queryKey: ["tags", "vocabulary"], queryFn: getVocabulary, staleTime: Infinity });
  const suggestions = vocabulary.data?.categories.find((c) => c.category === "occasion")?.tags ?? [];
  const [values, setValues] = useState({
    name: outfit.name,
    description: outfit.description ?? "",
    occasion: outfit.occasion ?? "",
    season: (outfit.season ?? "") as OutfitSeason | "",
    tags: outfit.style_tags.join(", "),
    notes: outfit.notes ?? "",
  });
  const set = (changes: Partial<typeof values>) => {
    setValues({ ...values, ...changes });
    onDirtyChange(true);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!values.name.trim()) return;
    onSave({
      name: values.name.trim(),
      description: values.description.trim() || null,
      occasion: values.occasion.trim() || null,
      season: values.season || null,
      style_tags: parseTags(values.tags),
      notes: values.notes.trim() || null,
    });
  };

  return (
    <form id={DETAILS_FORM_ID} onSubmit={submit} aria-label="Outfit details" className="space-y-3 text-xs text-ink-muted">
      <label className="block">
        Name
        <input required value={values.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} className={field} />
      </label>
      <label className="block">
        Description
        <textarea
          rows={2}
          value={values.description}
          maxLength={2000}
          onChange={(e) => set({ description: e.target.value })}
          className={field}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          Occasion
          <input
            list="occasion-suggestions"
            value={values.occasion}
            maxLength={80}
            onChange={(e) => set({ occasion: e.target.value })}
            className={field}
          />
          <datalist id="occasion-suggestions">
            {suggestions.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        </label>
        <label className="block">
          Season
          <select
            value={values.season}
            onChange={(e) => set({ season: e.target.value as OutfitSeason | "" })}
            className={field}
          >
            <option value="">Not set</option>
            {Object.entries(SEASON_NAMES).map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        Style tags, separated by commas
        <input value={values.tags} onChange={(e) => set({ tags: e.target.value })} className={field} />
      </label>
      <label className="block">
        Notes
        <textarea rows={3} value={values.notes} maxLength={2000} onChange={(e) => set({ notes: e.target.value })} className={field} />
      </label>
    </form>
  );
}
