"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, RefreshCw } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiError, apiUrl } from "@/lib/api-client";
import { copyText } from "@/lib/clipboard";
import { extractPalette } from "@/services/items";
import type { Harmony, Item, Palette, PaletteColor } from "@/types/api";

const HARMONY_TEXT: Record<Harmony, string> = {
  monochromatic: "Monochromatic — shades of a single hue",
  analogous: "Analogous — neighbouring hues",
  complementary: "Complementary — opposite hues",
  neutral: "Neutral — no strong hues",
  mixed: "Mixed — several unrelated hues",
};

const SOURCE_TEXT: Record<Palette["source"], string> = {
  original: "Measured across the whole image.",
  masked: "A plain backdrop was detected and left out.",
  cutout: "Measured on the cut-out garment.",
};

export function PaletteView({ item }: { item: Item }) {
  const queryClient = useQueryClient();
  const extraction = useMutation({
    mutationFn: () => extractPalette(item.id),
    onSuccess: (updated) => {
      queryClient.setQueryData(["items", "detail", item.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["items"] });
    },
    onError: () => {
      // The server recorded the failure on the item; refresh to show it.
      void queryClient.invalidateQueries({ queryKey: ["items", "detail", item.id] });
    },
  });

  const palette = item.palette;
  const failed = item.stage_status.palette === "failed";

  return (
    <section aria-labelledby="palette-title" className="rounded-2xl border border-line bg-paper-raised p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="palette-title" className="font-display text-xl">
          Colour palette
        </h2>
        {palette && item.palette_card_url && (
          <a
            href={apiUrl(item.palette_card_url)}
            download
            className="inline-flex items-center gap-1.5 rounded-full border border-ink/20 px-3.5 py-1.5 text-xs font-medium hover:border-ink/50"
          >
            <Download aria-hidden className="size-3.5" /> Export card
          </a>
        )}
      </div>

      <div className="mt-4" aria-live="polite" aria-busy={extraction.isPending}>
        {extraction.isPending ? (
          <div className="space-y-3" aria-label="Extracting palette">
            <div className="h-14 animate-pulse rounded-xl bg-ink/[0.06]" />
            <p className="text-sm text-ink-muted">Extracting colours…</p>
          </div>
        ) : palette ? (
          <PaletteDetails palette={palette} />
        ) : (
          <p className="text-sm text-ink-muted">
            {failed
              ? "The palette could not be extracted from this image. No colours are shown rather than guessed ones."
              : "This image has no palette yet."}
          </p>
        )}
      </div>

      {(failed || !palette) && !extraction.isPending && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => extraction.mutate()}>
            <RefreshCw aria-hidden className="size-4" />
            {failed ? "Try again" : "Extract palette"}
          </Button>
          {extraction.isError && (
            <span role="alert" className="text-sm text-danger">
              {extraction.error instanceof ApiError ? extraction.error.message : "Extraction failed."}
            </span>
          )}
        </div>
      )}
      {palette && failed && !extraction.isPending && (
        <p className="mt-3 text-xs text-warning">
          The latest re-extraction failed; showing the palette extracted earlier from this image.
        </p>
      )}
    </section>
  );
}

function PaletteDetails({ palette }: { palette: Palette }) {
  const reduceMotion = useReducedMotion();
  return (
    <div>
      {/* Proportional band: each colour's width is its share of the image. */}
      <div className="flex h-14 overflow-hidden rounded-xl" role="img" aria-label="Palette proportions">
        {palette.colors.map((color, index) => (
          <motion.span
            key={color.hex}
            title={`${color.name} · ${color.percentage}%`}
            style={{ backgroundColor: color.hex, flexGrow: color.percentage }}
            className="min-w-1 basis-0"
            initial={reduceMotion ? false : { flexGrow: 0 }}
            animate={{ flexGrow: color.percentage }}
            transition={{ duration: 0.6, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
          />
        ))}
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {palette.colors.map((color) => (
          <li key={color.hex}>
            <SwatchChip color={color} />
          </li>
        ))}
      </ul>

      <dl className="mt-4 space-y-1 text-xs text-ink-muted">
        {palette.harmony && (
          <div>
            <dt className="inline font-medium text-ink">Harmony (heuristic): </dt>
            <dd className="inline">{HARMONY_TEXT[palette.harmony]}</dd>
          </div>
        )}
        <div>
          <dt className="sr-only">Source</dt>
          <dd>
            {SOURCE_TEXT[palette.source]} Percentages are approximate; lighting and camera white
            balance shift colours.
          </dd>
        </div>
      </dl>
    </div>
  );
}

function SwatchChip({ color }: { color: PaletteColor }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    setState((await copyText(color.hex)) ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1800);
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="group flex w-full items-center gap-3 rounded-xl border border-line bg-paper p-2 text-left transition-colors hover:border-ink/40"
    >
      <span aria-hidden className="size-10 shrink-0 rounded-lg border border-ink/10" style={{ backgroundColor: color.hex }} />
      <span className="min-w-0 flex-1">
        {/* The accessible name is the visible text plus "Copy" (so voice control matches it). */}
        <span className="sr-only">Copy</span>{" "}
        <span className="block truncate text-sm capitalize">{color.name}</span>{" "}
        <span className="flex items-center gap-1.5 font-mono text-xs text-ink-muted">
          {color.hex.toUpperCase()} · {color.percentage}%
        </span>
      </span>
      <span aria-live="polite" className="shrink-0 text-ink-muted">
        {state === "copied" ? (
          <span className="flex items-center gap-1 text-xs text-success">
            <Check aria-hidden className="size-3.5" /> Copied
          </span>
        ) : state === "failed" ? (
          <span className="text-xs text-danger">Copy failed</span>
        ) : (
          <Copy aria-hidden className="size-3.5 opacity-50 group-hover:opacity-100" />
        )}
      </span>
    </button>
  );
}
