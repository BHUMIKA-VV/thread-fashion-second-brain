"use client";

import { ArrowDown, ArrowUp, Replace, X } from "lucide-react";
import { useState } from "react";

import { apiUrl } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { layoutPlan, type OutfitLayout as Layout } from "@/lib/outfit-layout";
import type { OutfitPieceRead, OutfitPieceRole } from "@/types/api";

import { LAYOUT_NAMES, pieceLabel, ROLE_NAMES } from "./names";

const LAYOUTS: Layout[] = ["feature", "grid", "column"];
const ROLES: OutfitPieceRole[] = ["piece", "accessory", "inspiration"];

export function LayoutChooser({ value, onChange }: { value: Layout; onChange: (layout: Layout) => void }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="sr-only">Layout</legend>
      {LAYOUTS.map((layout) => (
        <label
          key={layout}
          className={cn(
            "cursor-pointer rounded-[2px] border px-3 py-1.5 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
            value === layout ? "border-ink bg-ink text-paper-raised" : "border-line text-ink-muted hover:text-ink",
          )}
        >
          <input
            type="radio"
            name="outfit-layout"
            value={layout}
            checked={value === layout}
            onChange={() => onChange(layout)}
            className="sr-only"
          />
          {LAYOUT_NAMES[layout]}
        </label>
      ))}
    </fieldset>
  );
}

/** The image-led composition. Dragging is a shortcut; the list below does everything too. */
export function Composition({
  pieces,
  layout,
  onMove,
}: {
  pieces: OutfitPieceRead[];
  layout: Layout;
  onMove: (from: number, to: number) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const plan = layoutPlan(layout, pieces.length);

  if (pieces.length === 0) {
    return (
      <div className="flex min-h-80 flex-col items-center justify-center border border-dashed border-line px-6 py-16 text-center">
        <p className="font-display text-2xl">Nothing composed yet</p>
        <p className="mt-2 max-w-sm text-sm text-ink-muted">Choose pieces from your archive to place them here.</p>
      </div>
    );
  }
  return (
    <div
      className={cn("grid gap-1.5", layout === "column" && "mx-auto max-w-md")}
      style={{ gridTemplateColumns: `repeat(${plan.cols}, minmax(0, 1fr))` }}
      data-testid="outfit-composition"
    >
      {pieces.map((piece, index) => {
        const cell = plan.cells[index];
        return (
          <figure
            key={piece.item.id}
            draggable
            onDragStart={() => setDragging(index)}
            onDragEnd={() => setDragging(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (dragging !== null && dragging !== index) onMove(dragging, index);
              setDragging(null);
            }}
            className={cn("relative cursor-grab overflow-hidden bg-paper-raised", dragging === index && "opacity-50")}
            style={{
              gridColumn: `${cell.col} / span ${cell.colSpan}`,
              gridRow: `${cell.row} / span ${cell.rowSpan}`,
              // A two-column tile beside a one-column one takes its height from that row, so
              // the column gap can't make the two differ.
              aspectRatio:
                cell.colSpan === 2 && cell.rowSpan === 1
                  ? undefined
                  : `${cell.colSpan * plan.cellAspect} / ${cell.rowSpan}`,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- private image served by the API */}
            <img
              src={apiUrl(cell.colSpan > 1 ? piece.item.image_url : piece.item.thumbnail_url)}
              alt={pieceLabel(piece.item)}
              draggable={false}
              loading="lazy"
              className="absolute inset-0 size-full object-cover"
            />
            {piece.role !== "piece" && (
              <figcaption className="absolute bottom-1 left-1 bg-paper-raised px-1.5 py-0.5 text-[11px] text-ink">
                {ROLE_NAMES[piece.role]}
              </figcaption>
            )}
          </figure>
        );
      })}
    </div>
  );
}

const control =
  "inline-flex size-9 items-center justify-center rounded-[2px] border border-line text-ink transition-colors hover:border-ink aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:border-line";

/** The same actions as text and buttons, for keyboards, screen readers and small screens. */
export function PieceList({
  pieces,
  replacingId,
  onMove,
  onRole,
  onReplace,
  onRemove,
}: {
  pieces: OutfitPieceRead[];
  replacingId: string | null;
  onMove: (from: number, to: number) => void;
  onRole: (index: number, role: OutfitPieceRole) => void;
  onReplace: (itemId: string) => void;
  onRemove: (index: number) => void;
}) {
  const last = pieces.length - 1;
  return (
    <ol aria-label="Pieces in this outfit, in order" className="divide-y divide-line border-y border-line">
      {pieces.map((piece, index) => {
        const label = pieceLabel(piece.item);
        return (
          <li key={piece.item.id} className="flex flex-wrap items-center gap-3 py-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- private image served by the API */}
            <img src={apiUrl(piece.item.thumbnail_url)} alt="" loading="lazy" className="size-12 object-cover" />
            <span className="min-w-24 flex-1 truncate text-sm">
              <span className="text-ink-muted">{index + 1}. </span>
              {label}
            </span>
            <label className="text-xs text-ink-muted">
              <span className="sr-only">Role of {label}</span>
              <select
                value={piece.role}
                onChange={(e) => onRole(index, e.target.value as OutfitPieceRole)}
                className="rounded-[2px] border border-line bg-paper-raised px-2 py-2 text-sm text-ink"
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_NAMES[role]}
                  </option>
                ))}
              </select>
            </label>
            <span className="flex gap-1">
              {/* aria-disabled, not disabled: the button keeps keyboard focus at either end. */}
              <button
                type="button"
                aria-label={`Move ${label} earlier`}
                aria-disabled={index === 0}
                onClick={() => index > 0 && onMove(index, index - 1)}
                className={control}
              >
                <ArrowUp aria-hidden className="size-4" />
              </button>
              <button
                type="button"
                aria-label={`Move ${label} later`}
                aria-disabled={index === last}
                onClick={() => index < last && onMove(index, index + 1)}
                className={control}
              >
                <ArrowDown aria-hidden className="size-4" />
              </button>
              <button
                type="button"
                aria-label={`Replace ${label}`}
                aria-pressed={replacingId === piece.item.id}
                data-focus-key={`replace-${piece.item.id}`}
                onClick={() => onReplace(piece.item.id)}
                className={cn(control, replacingId === piece.item.id && "border-ink bg-ink text-paper-raised")}
              >
                <Replace aria-hidden className="size-4" />
              </button>
              <button
                type="button"
                aria-label={`Remove ${label}`}
                data-focus-key={`remove-${piece.item.id}`}
                onClick={() => onRemove(index)}
                className={control}
              >
                <X aria-hidden className="size-4" />
              </button>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
