"use client";

import { ChevronLeft, ChevronRight, Expand, Minimize, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";

import { Button } from "@/components/ui/button";
import { pieceLabel } from "@/features/outfit-studio/names";
import { apiUrl } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import type { Item } from "@/types/api";

import { slideTitle, type Slide } from "./slides";

const SWIPE_PX = 60;

/** The slide number from a "#slide-3" hash, if it names a slide; slides are counted from 1. */
export function slideFromHash(hash: string, total: number): number {
  const match = /^#slide-(\d+)$/.exec(hash);
  const n = match ? Number(match[1]) : 1;
  return Math.min(Math.max(n, 1), total) - 1;
}

/**
 * Full-window slides for a client meeting. Arrow keys, Page Up/Down, Home and End move between
 * slides, Escape leaves, a swipe works on touch screens. Internal detail (type, Thread's AI
 * suggestion, processing status, record number) stays hidden unless the presenter turns it on.
 */
export function Presenter({ slides, exitHref, name }: { slides: Slide[]; exitHref: string; name: string }) {
  const router = useRouter();
  // It only renders in the browser, once the data has loaded; the guard is for safety.
  const browser = typeof window !== "undefined";
  const [index, setIndex] = useState(() => (browser ? slideFromHash(window.location.hash, slides.length) : 0));
  const [details, setDetails] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen] = useState(() => browser && Boolean(document.fullscreenEnabled));
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const swipe = useRef<number | null>(null);
  const last = slides.length - 1;

  const go = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(next, 0), last);
      setIndex(clamped);
      window.history.replaceState(null, "", `#slide-${clamped + 1}`);
    },
    [last],
  );

  // Start where the address says (a reload keeps the slide, see useState above), take the
  // keyboard, and keep the page behind from scrolling.
  useEffect(() => {
    stage.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onFullscreen = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("fullscreenchange", onFullscreen);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      // Space belongs to a focused button, link or field.
      const { target } = event;
      const onControl = target instanceof Element && target.closest("button, a, input, select, textarea") !== null;
      if (event.key === "ArrowRight" || event.key === "PageDown" || (event.key === " " && !onControl)) go(index + 1);
      else if (event.key === "ArrowLeft" || event.key === "PageUp") go(index - 1);
      else if (event.key === "Home") go(0);
      else if (event.key === "End") go(last);
      else if (event.key === "Escape") router.push(exitHref);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index, last, exitHref, router]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void root.current?.requestFullscreen().catch(() => {});
  };
  const onPointerDown = (event: PointerEvent) => {
    swipe.current = event.pointerType === "mouse" ? null : event.clientX;
  };
  const onPointerUp = (event: PointerEvent) => {
    if (swipe.current === null) return;
    const dx = event.clientX - swipe.current;
    swipe.current = null;
    if (Math.abs(dx) >= SWIPE_PX) go(index + (dx < 0 ? 1 : -1));
  };

  const slide = slides[Math.min(index, last)];
  const title = slideTitle(slide);
  return (
    <div ref={root} className="fixed inset-0 z-50 flex flex-col bg-paper text-ink">
      <h1 className="sr-only">Presenting {name}</h1>
      <div
        ref={stage}
        // In the tab order: on a phone a slide can scroll, and the keyboard must reach it. The
        // global focus ring is unlayered, so the inset ring here needs ! to win.
        tabIndex={0}
        role="region"
        aria-roledescription="slide"
        aria-label={`Slide ${index + 1} of ${slides.length}: ${title}`}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        className="min-h-0 flex-1 touch-pan-y overflow-y-auto focus-visible:outline-1! focus-visible:outline-offset-[-3px]! focus-visible:outline-ink/30!"
      >
        <div key={index} className="present-slide flex min-h-full items-center justify-center px-6 py-10 wrap-anywhere sm:px-16">
          <SlideView slide={slide} details={details} />
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {`Slide ${index + 1} of ${slides.length}: ${title}`}
      </p>

      <nav aria-label="Presentation" className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2 text-sm">
        {/* aria-disabled, not disabled, so a focused button keeps focus at either end. */}
        <Button
          variant="ghost"
          onClick={() => go(index - 1)}
          aria-disabled={index === 0}
          aria-label="Previous slide"
          className="aria-disabled:cursor-default aria-disabled:opacity-40"
        >
          <ChevronLeft aria-hidden className="size-5" />
        </Button>
        <span className="tabular-nums text-ink-muted" aria-hidden>
          {index + 1} / {slides.length}
        </span>
        <Button
          variant="ghost"
          onClick={() => go(index + 1)}
          aria-disabled={index === last}
          aria-label="Next slide"
          className="aria-disabled:cursor-default aria-disabled:opacity-40"
        >
          <ChevronRight aria-hidden className="size-5" />
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="ghost" aria-pressed={details} onClick={() => setDetails((d) => !d)}>
            {details ? "Hide details" : "Show details"}
          </Button>
          {canFullscreen && (
            <Button variant="ghost" aria-pressed={fullscreen} onClick={toggleFullscreen}>
              {fullscreen ? <Minimize aria-hidden className="size-4" /> : <Expand aria-hidden className="size-4" />}
              {fullscreen ? "Leave full screen" : "Full screen"}
            </Button>
          )}
          <Link
            href={exitHref}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-[2px] px-3 text-ink-muted hover:text-ink"
          >
            <X aria-hidden className="size-4" /> Exit
          </Link>
        </div>
      </nav>
    </div>
  );
}

function Swatch({ hex, className }: { hex: string; className?: string }) {
  return <span aria-hidden className={cn("block shrink-0 border border-ink/15", className)} style={{ backgroundColor: hex }} />;
}

function SlideView({ slide, details }: { slide: Slide; details: boolean }) {
  switch (slide.kind) {
    case "cover":
      return (
        <div className="w-full max-w-4xl text-center">
          <p className="text-[11px] uppercase tracking-[0.28em] text-ink-muted">{slide.facts}</p>
          <h2 className="mt-4 break-words font-display text-5xl leading-tight tracking-tight sm:text-7xl">{slide.title}</h2>
          {slide.description && <p className="mt-6 whitespace-pre-line text-lg text-ink-muted sm:text-xl">{slide.description}</p>}
        </div>
      );
    case "section":
      return <h2 className="w-full max-w-4xl break-words text-center font-display text-4xl leading-tight sm:text-6xl">{slide.title}</h2>;
    case "note":
      return (
        <p className="w-full max-w-3xl whitespace-pre-line break-words border-l-2 border-clay pl-6 text-xl leading-relaxed sm:text-2xl">
          {slide.body}
        </p>
      );
    case "piece":
      return <PieceSlide item={slide.item} caption={slide.caption} details={details} />;
    case "colour":
      return (
        <div className="grid w-full max-w-5xl items-center gap-8 md:grid-cols-2">
          <Swatch hex={slide.hex} className="aspect-[4/5] w-full max-w-md justify-self-center" />
          <div>
            <h2 className="font-display text-4xl capitalize sm:text-5xl">{slide.name}</h2>
            <p className="mt-2 font-mono text-ink-muted">{slide.hex.toUpperCase()}</p>
            {slide.caption && <p className="mt-6 whitespace-pre-line text-xl">{slide.caption}</p>}
            {slide.match && <p className="mt-4 text-ink-muted">{slide.match}</p>}
          </div>
        </div>
      );
    case "story": {
      const total = slide.measured.reduce((sum, c) => sum + c.share, 0) || 1;
      return (
        <div className="w-full max-w-4xl">
          <h2 className="font-display text-4xl sm:text-5xl">Colour story</h2>
          {slide.harmony && <p className="mt-3 text-lg text-ink-muted">Harmony: {slide.harmony}</p>}
          {slide.measured.length > 0 && (
            <>
              <div className="mt-8 flex h-10 w-full overflow-hidden" role="img" aria-label={`Measured colours: ${slide.measured.map((c) => c.name).join(", ")}`}>
                {slide.measured.map((c) => (
                  <span key={c.hex} style={{ backgroundColor: c.hex, width: `${(c.share / total) * 100}%` }} />
                ))}
              </div>
              <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                {slide.measured.map((c) => (
                  <li key={c.hex} className="flex items-center gap-2">
                    <Swatch hex={c.hex} className="size-4" />
                    <span className="capitalize">{c.name}</span>
                    <span className="text-ink-muted">{Math.round(c.share)}%</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {slide.chosen.length > 0 && (
            <ul aria-label="Chosen colours" className="mt-8 space-y-3">
              {slide.chosen.map((c) => (
                <li key={c.hex + c.text} className="flex gap-3">
                  <Swatch hex={c.hex} className="size-6" />
                  <span>
                    <span className="capitalize">{c.name}</span> <span className="font-mono text-sm text-ink-muted">{c.hex.toUpperCase()}</span>
                    <span className="block text-sm text-ink-muted">{c.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-8 text-xs text-ink-muted">Measured from the photographs and compared with CIEDE2000; nothing here is written by a model.</p>
        </div>
      );
    }
    case "end":
      return (
        <div className="w-full text-center">
          <h2 className="break-words font-display text-4xl sm:text-5xl">{slide.title}</h2>
          <p className="mt-4 text-ink-muted">End of presentation. Press Escape to leave.</p>
        </div>
      );
  }
}

function PieceSlide({ item, caption, details }: { item: Item; caption: string | null; details: boolean }) {
  const colours = item.palette?.colors ?? [];
  const note = item.notes?.trim();
  return (
    <div className="grid w-full max-w-6xl items-center gap-8 md:grid-cols-[3fr_2fr]">
      {/* eslint-disable-next-line @next/next/no-img-element -- private image served by the API */}
      <img src={apiUrl(item.image_url)} alt={pieceLabel(item)} className="max-h-[72vh] w-full object-contain" />
      <div className="min-w-0">
        {caption && <h2 className="whitespace-pre-line break-words font-display text-3xl leading-tight sm:text-4xl">{caption}</h2>}
        {note && <p className={cn("whitespace-pre-line break-words text-ink-muted", caption ? "mt-4" : "font-display text-3xl text-ink sm:text-4xl")}>{note}</p>}
        {!caption && !note && <h2 className="font-display text-3xl capitalize">{pieceLabel(item)}</h2>}
        {item.source_url && (
          <p className="mt-3 break-all text-sm text-ink-muted">
            Source: <a href={item.source_url} className="underline" target="_blank" rel="noreferrer">{item.source_url}</a>
          </p>
        )}
        {colours.length > 0 && (
          <ul aria-label="Measured colours" className="mt-6 space-y-2 text-sm">
            {colours.slice(0, 5).map((c) => (
              <li key={c.hex} className="flex items-center gap-2">
                <Swatch hex={c.hex} className="size-5" />
                <span className="capitalize">{c.name}</span>
                <span className="font-mono text-xs text-ink-muted">{c.hex.toUpperCase()}</span>
              </li>
            ))}
          </ul>
        )}
        {details && (
          <dl aria-label="Piece details" className="mt-6 space-y-1 border-t border-line pt-4 text-sm">
            <div>
              <dt className="inline text-ink-muted">Type: </dt>
              <dd className="inline capitalize">{item.type}</dd>
            </div>
            <div>
              <dt className="inline text-ink-muted">Record: </dt>
              <dd className="inline font-mono">{item.id.slice(0, 8).toUpperCase()}</dd>
            </div>
            {item.suggested_type && item.suggested_type !== item.type && (
              <div>
                <dt className="inline text-ink-muted">Thread suggested: </dt>
                <dd className="inline capitalize">{item.suggested_type} (an AI guess, not used)</dd>
              </div>
            )}
            <div>
              <dt className="inline text-ink-muted">Status: </dt>
              <dd className="inline">{item.processing_status}</dd>
            </div>
            <div>
              <dt className="inline text-ink-muted">Photograph: </dt>
              <dd className="inline">
                {item.width} × {item.height} px
              </dd>
            </div>
            {colours.length > 0 && (
              <div>
                <dt className="inline text-ink-muted">Colour shares: </dt>
                <dd className="inline">{colours.map((c) => `${c.name} ${Math.round(c.percentage)}%`).join(", ")}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </div>
  );
}
