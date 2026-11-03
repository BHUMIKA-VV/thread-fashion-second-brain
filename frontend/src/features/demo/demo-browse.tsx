"use client";

import { Search } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { FilterChip, TYPE_NAMES } from "@/features/gallery/gallery";
import { cn } from "@/lib/cn";
import { FAMILY_SWATCH } from "@/lib/colour-families";
import type { ColorFamily, ItemType } from "@/types/api";

import { filterDemo, NO_FILTERS, type DemoFilters, type DemoPiece } from "./demo-data";
import { DemoTile } from "./demo-tile";

/** Search and filter the demo pieces, entirely in the browser: nothing is requested. */
export function DemoBrowse({ pieces, families }: { pieces: DemoPiece[]; families: ColorFamily[] }) {
  const [filters, setFilters] = useState<DemoFilters>(NO_FILTERS);
  const [q, setQ] = useState("");
  const shown = useMemo(() => filterDemo(pieces, filters), [pieces, filters]);
  const types = useMemo(() => [...new Set(pieces.map((p) => p.type))], [pieces]);
  const active = filters.q !== "" || filters.families.length > 0 || filters.type !== null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFilters({ ...filters, q: q.trim() });
  };
  const toggleFamily = (family: ColorFamily) =>
    setFilters({
      ...filters,
      families: filters.families.includes(family) ? filters.families.filter((f) => f !== family) : [...filters.families, family],
    });
  const clear = () => {
    setQ("");
    setFilters(NO_FILTERS);
  };

  return (
    <div className="space-y-8">
      <div className="space-y-5 border-y border-line py-5">
        <form role="search" onSubmit={submit} className="flex max-w-xl items-center gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Search the demo</span>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              maxLength={100}
              placeholder="Search by colour, craft or type, e.g. bandhani"
              className="block w-full rounded-[2px] border border-line bg-paper-raised px-3 py-2 text-base text-ink sm:text-sm"
            />
          </label>
          <Button type="submit" variant="secondary">
            <Search aria-hidden className="size-4" /> Search
          </Button>
        </form>
        <div role="group" aria-label="Filter by colour" className="flex flex-wrap items-center gap-1.5">
          {families.map((family) => {
            const on = filters.families.includes(family);
            return (
              <button
                key={family}
                type="button"
                aria-pressed={on}
                aria-label={family}
                title={family}
                onClick={() => toggleFamily(family)}
                className={cn("size-6 border transition-transform motion-reduce:transition-none", on ? "scale-110 border-ink" : "border-ink/15")}
                style={{ backgroundColor: FAMILY_SWATCH[family] }}
              />
            );
          })}
        </div>
        <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-x-5 gap-y-1">
          <FilterChip active={filters.type === null} onClick={() => setFilters({ ...filters, type: null })}>
            Everything
          </FilterChip>
          {types.map((type: ItemType) => (
            <FilterChip key={type} active={filters.type === type} onClick={() => setFilters({ ...filters, type })}>
              {TYPE_NAMES[type]}
            </FilterChip>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-ink-muted" aria-live="polite">
          {shown.length} of {pieces.length} pieces
        </p>
        {active && (
          <button type="button" onClick={clear} className="text-sm text-ink-muted underline underline-offset-4 hover:text-ink">
            Clear search and filters
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="border-y border-line py-16 text-center text-ink-muted">No demo pieces match. Try another colour or word.</p>
      ) : (
        <ul aria-label="Demo pieces" className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((piece) => (
            <li key={piece.id}>
              <DemoTile piece={piece} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
