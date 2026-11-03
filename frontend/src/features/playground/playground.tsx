"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Download, ImagePlus, RefreshCw } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type DragEvent } from "react";

import { Button, ButtonLink } from "@/components/ui/button";
import { PaletteDetails } from "@/features/palette/palette-view";
import { ApiError } from "@/lib/api-client";
import { countView } from "@/lib/beacon";
import { cn } from "@/lib/cn";
import { CATEGORY_LABEL, TYPE_LABELS } from "@/lib/labels";
import { renderSwatchCard } from "@/lib/swatch-card";
import { analysePhoto, PLAYGROUND_FORMATS, PLAYGROUND_MAX_BYTES } from "@/services/playground";
import { ITEM_TYPES, type ItemType, type PlaygroundMatch, type PlaygroundResult, type TagCategory } from "@/types/api";

const CONTROL =
  "mt-1.5 block w-full rounded-[2px] border border-ink/25 bg-paper px-3 py-2.5 text-sm text-ink focus:border-ink focus:outline-none";

/**
 * Try Thread on one photo, with no account. The photo is previewed from the visitor's own
 * device, sent once to be measured (the API keeps nothing), and the swatch card is drawn in the
 * browser from that same preview.
 */
export function Playground() {
  const [type, setType] = useState<ItemType | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const typeId = useId();

  const analysis = useMutation({
    mutationFn: ({ photo, as }: { photo: File; as: ItemType | "" }) => analysePhoto(photo, as || null),
    onSuccess: () => countView("playground_analysis"),
  });

  // The preview is a local blob URL: forget it when the photo changes or the page closes.
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const choose = (chosen: File | undefined) => {
    if (!chosen) return;
    if (!PLAYGROUND_FORMATS.includes(chosen.type)) {
      setProblem("Choose a JPEG, PNG or WebP photo.");
      return;
    }
    if (chosen.size > PLAYGROUND_MAX_BYTES) {
      setProblem("That photo is larger than 8 MB. Try a smaller copy.");
      return;
    }
    setProblem(null);
    setFile(chosen);
    setPreview(URL.createObjectURL(chosen));
    analysis.mutate({ photo: chosen, as: type });
  };

  const changeType = (value: ItemType | "") => {
    setType(value);
    if (file) analysis.mutate({ photo: file, as: value });
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files[0]);
  };

  const error = analysis.error instanceof ApiError ? analysis.error : null;
  const result = analysis.isPending ? undefined : analysis.data;

  return (
    <div className="space-y-12">
      <div className="grid gap-8 lg:grid-cols-12">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center justify-center rounded-[2px] border border-dashed px-6 py-12 text-center transition-colors lg:col-span-7",
            dragging ? "border-clay bg-clay/5" : "border-ink/25 bg-paper-raised",
          )}
        >
          <ImagePlus aria-hidden className="size-8 text-ink-muted" />
          <p className="mt-4 font-display text-2xl">{file ? "Try another photo" : "Drop a photo here"}</p>
          <p className="mt-2 text-sm text-ink-muted">A garment, an outfit, a fabric · JPEG, PNG or WebP · up to 8 MB</p>
          <Button className="mt-6" onClick={() => picker.current?.click()} disabled={analysis.isPending}>
            <ImagePlus aria-hidden className="size-4" /> Choose a photo
          </Button>
          <input
            ref={picker}
            type="file"
            accept={PLAYGROUND_FORMATS.join(",")}
            className="sr-only"
            aria-label="Photo to analyse"
            tabIndex={-1}
            onChange={(e) => {
              choose(e.target.files?.[0]);
              e.target.value = ""; // choosing the same file again still analyses it
            }}
          />
        </div>

        <div className="space-y-5 lg:col-span-5">
          <label htmlFor={typeId} className="block text-xs tracking-[0.04em] text-ink-muted">
            What is in the photo?
            <select
              id={typeId}
              value={type}
              onChange={(e) => changeType(e.target.value as ItemType | "")}
              disabled={analysis.isPending}
              className={CONTROL}
            >
              <option value="">Let Thread suggest</option>
              {ITEM_TYPES.map((value) => (
                <option key={value} value={value}>
                  {TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <PrivacyNote />
        </div>
      </div>

      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}

      <section aria-labelledby="results-title" aria-busy={analysis.isPending} aria-live="polite">
        {analysis.isPending ? (
          <div role="status" aria-label="Measuring the photo" className="space-y-3">
            <div className="h-14 animate-pulse rounded-[2px] bg-ink/[0.06]" />
            <p className="text-sm text-ink-muted">Measuring colours and comparing with the demo…</p>
          </div>
        ) : error ? (
          <div role="alert" className="border-y border-danger/30 py-8 text-center">
            <p className="font-display text-xl">{error.message}</p>
            {file && (error.status === 503 || error.status === 0) && (
              <Button className="mt-5" variant="secondary" onClick={() => analysis.mutate({ photo: file, as: type })}>
                <RefreshCw aria-hidden className="size-4" /> Try again
              </Button>
            )}
          </div>
        ) : analysis.isError ? (
          <p role="alert" className="text-sm text-danger">
            The photo could not be analysed.
          </p>
        ) : null}
        {result && preview && file && (
          <Results result={result} preview={preview} onRetry={() => analysis.mutate({ photo: file, as: type })} />
        )}
      </section>
    </div>
  );
}

function PrivacyNote() {
  return (
    <div className="border-t border-line pt-4 text-sm leading-relaxed text-ink-muted">
      <p>
        <span className="text-ink">No account, nothing kept.</span> Your photo is sent to Thread&apos;s server only to
        be measured, then discarded: it isn&apos;t saved, logged or shown to anyone. The swatch card is drawn in your
        browser.
      </p>
      <p className="mt-2">
        Results are compared only with the{" "}
        <Link href="/demo" className="text-ink underline underline-offset-4">
          twenty museum pieces in the demo
        </Link>
        .{" "}
        <Link href="/privacy" className="underline underline-offset-4">
          Privacy
        </Link>
      </p>
    </div>
  );
}

const TYPE_SOURCE: Record<PlaygroundResult["type_source"], string> = {
  chosen: "as you chose",
  suggested: "suggested by the image model",
  default: "Thread couldn't tell what it shows",
};

function Results({ result: r, preview, onRetry }: { result: PlaygroundResult; preview: string; onRetry: () => void }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Keyboard and screen-reader users land on each new result, not at the top of the page.
  useEffect(() => titleRef.current?.focus(), [r]);
  return (
    <div className="space-y-14">
      <div className="grid gap-10 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <h2 ref={titleRef} id="results-title" tabIndex={-1} className="font-display text-3xl tracking-tight outline-none">
            What Thread measured
          </h2>
          {/* A local preview of the visitor's own photo (a blob: URL), so next/image can't serve it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Your photo" className="mt-5 max-h-[32rem] w-auto max-w-full border border-line object-contain" />
          <p className="mt-2 text-xs text-ink-muted">
            {r.width} × {r.height} px · read as <span className="text-ink">{TYPE_LABELS[r.type]}</span>,{" "}
            {TYPE_SOURCE[r.type_source]}
          </p>
          <div className="mt-5">
            <CardButton result={r} preview={preview} />
          </div>
        </div>

        <div className="space-y-10 lg:col-span-7">
          <section aria-labelledby="pg-palette" className="border-t border-ink pt-5">
            <h3 id="pg-palette" className="font-display text-xl">
              Colour palette
            </h3>
            <div className="mt-4">
              {r.palette.length && r.palette_source ? (
                <PaletteDetails palette={{ colors: r.palette, harmony: r.harmony, source: r.palette_source }} />
              ) : (
                <p className="text-sm text-ink-muted">No colours could be measured in this photo, so none are shown.</p>
              )}
            </div>
          </section>

          <section aria-labelledby="pg-tags" className="border-t border-ink pt-5">
            <h3 id="pg-tags" className="font-display text-xl">
              Suggested tags
            </h3>
            <ModelNote result={r} onRetry={onRetry} />
            {r.tags.length > 0 && <Tags tags={r.tags} />}
          </section>
        </div>
      </div>

      {r.similar_look.length > 0 && (
        <Matches
          id="pg-look"
          title="Kindred by look"
          note="Demo pieces the image model sees as most alike (1.00 would be identical)."
          matches={r.similar_look}
          label={(m) => `Similarity ${m.similarity?.toFixed(2)}`}
        />
      )}
      {r.similar_palette.length > 0 && (
        <Matches
          id="pg-palette-matches"
          title="Kindred by palette"
          note="Demo pieces with the closest palettes, by colour distance (CIEDE2000; lower is closer)."
          matches={r.similar_palette}
          label={(m) => `Distance ${m.distance?.toFixed(1)}`}
        />
      )}

      <NextSteps />
    </div>
  );
}

function ModelNote({ result: r, onRetry }: { result: PlaygroundResult; onRetry: () => void }) {
  if (r.model === "loading") {
    return (
      <div className="mt-3 text-sm text-ink-muted">
        <p>The image model is starting up, so there are no tags or look-alikes yet. The palette above is complete.</p>
        <Button className="mt-3" variant="secondary" onClick={onRetry}>
          <RefreshCw aria-hidden className="size-4" /> Try again with the model
        </Button>
      </div>
    );
  }
  if (r.model === "unavailable") {
    return (
      <p className="mt-3 text-sm text-ink-muted">
        The image model isn&apos;t running on this server, so only the palette is shown. Nothing is guessed in its place.
      </p>
    );
  }
  if (r.tags.length === 0) {
    return <p className="mt-3 text-sm text-ink-muted">The image model wasn&apos;t confident enough to suggest any tags.</p>;
  }
  return (
    <p className="mt-2 text-sm text-ink-muted">
      From an image model, with how strongly it preferred each tag within its category. They can be wrong; fabric is
      only ever a guess from a photo.
      {!r.look_compared && " Look-alikes are left out because the demo was indexed by a different model."}
    </p>
  );
}

function Tags({ tags }: { tags: PlaygroundResult["tags"] }) {
  const byCategory = new Map<TagCategory, PlaygroundResult["tags"]>();
  for (const t of tags) byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), t]);
  return (
    <dl className="mt-4 space-y-3 text-sm">
      {[...byCategory].map(([category, list]) => (
        <div key={category} className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3">
          <dt className="text-ink-muted">{CATEGORY_LABEL[category] ?? category}</dt>
          <dd>
            {list.map((t, i) => (
              <span key={t.tag}>
                {i > 0 && ", "}
                {t.tag}
                <span className="text-ink-muted">
                  {" "}
                  ({t.is_guess ? "guess, " : ""}
                  {Math.round(t.score * 100)}%)
                </span>
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Matches({
  id,
  title,
  note,
  matches,
  label,
}: {
  id: string;
  title: string;
  note: string;
  matches: PlaygroundMatch[];
  label: (m: PlaygroundMatch) => string;
}) {
  return (
    <section aria-labelledby={id} className="border-t border-ink pt-5">
      <h3 id={id} className="font-display text-2xl">
        {title}
      </h3>
      <p className="mt-1 text-sm text-ink-muted">{note}</p>
      <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
        {matches.map((m) => (
          <li key={m.id}>
            <Link href={`/demo/pieces/${m.id}`} className="group block">
              <span className="relative block aspect-[3/4] overflow-hidden bg-paper-raised">
                <Image src={`/demo/${m.thumbnail}`} alt={m.title} fill sizes="(min-width: 1024px) 16vw, (min-width: 640px) 33vw, 50vw" className="object-cover" />
              </span>
              <span className="block border-b border-line py-2.5">
                <span className="block text-[11px] uppercase tracking-[0.2em] text-ink-muted">{m.type}</span>
                <span className="mt-1 block text-sm leading-snug text-ink group-hover:underline">{m.title}</span>
              </span>
            </Link>
            <p className="mt-1 font-mono text-xs text-ink-muted">{label(m)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CardButton({ result, preview }: { result: PlaygroundResult; preview: string }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  if (result.palette.length === 0) return null;
  const download = async () => {
    setState("busy");
    try {
      const blob = await renderSwatchCard({
        imageUrl: preview,
        wordmarkUrl: "/brand/thread-wordmark.png",
        colours: result.palette,
        caption: `${TYPE_LABELS[result.type]} · Measured by Thread`,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "thread-swatch-card.png";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setState("idle");
    } catch {
      setState("error");
    }
  };
  return (
    <div>
      <Button variant="secondary" onClick={() => void download()} disabled={state === "busy"}>
        <Download aria-hidden className="size-4" /> {state === "busy" ? "Making the card…" : "Download swatch card"}
      </Button>
      {state === "error" && (
        <p role="alert" className="mt-2 text-sm text-danger">
          The card could not be made in this browser.
        </p>
      )}
    </div>
  );
}

function NextSteps() {
  return (
    <section aria-labelledby="pg-next" className="border-y border-line bg-paper-raised px-5 py-10 sm:px-8">
      <h3 id="pg-next" className="font-display text-3xl tracking-tight">
        Keep pieces like this
      </h3>
      <p className="mt-3 max-w-2xl leading-relaxed text-ink-muted">
        In your own archive, every piece you add is measured like this and stays private to you, so you can search by
        colour, compare palettes and compose outfits. For a studio or boutique, the pilot sets it up with you.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <ButtonLink href="/signup">
          Create your archive <ArrowRight aria-hidden className="size-4" />
        </ButtonLink>
        <ButtonLink href="/pilot" variant="secondary">
          Studio pilot
        </ButtonLink>
        <ButtonLink href="/demo" variant="ghost">
          Explore the demo
        </ButtonLink>
      </div>
    </section>
  );
}
