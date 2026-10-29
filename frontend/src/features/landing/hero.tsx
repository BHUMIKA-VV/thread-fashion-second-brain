"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";
import { apiUrl } from "@/lib/api-client";
import { listItems } from "@/services/items";
import type { Item } from "@/types/api";

/**
 * The landing page: an asymmetric editorial grid. The wordmark and tagline hold the left
 * two-thirds; one image (the newest piece in your own archive) sits in the right column, dropped
 * below the wordmark's baseline. Nothing here is decorative data: the image and its colours are
 * real, and an empty archive shows an honest invitation instead.
 */
export function Hero() {
  const reduceMotion = useReducedMotion();
  const latest = useQuery({ queryKey: ["items", "list", "landing"], queryFn: () => listItems({ limit: 1 }) });
  const item = latest.data?.items[0];

  const rise = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pb-10 pt-8 sm:px-8 sm:pt-12">
      <motion.div
        {...rise(0)}
        className="flex items-baseline justify-between border-b border-line pb-3 text-[11px] uppercase tracking-[0.28em] text-ink-muted"
      >
        <span>A personal fashion archive</span>
        <span className="hidden sm:inline">Garments · Fabrics · Colour · Craft</span>
      </motion.div>

      <div className="mt-10 grid gap-x-6 gap-y-10 lg:grid-cols-12">
        <motion.h1 {...rise(0.05)} className="lg:col-span-8 lg:col-start-1 lg:row-start-1">
          <Logo height={300} fluid priority label="Thread" className="max-w-[760px]" />
        </motion.h1>

        <motion.p
          {...rise(0.12)}
          className="text-balance font-display text-[2rem] italic leading-[1.1] tracking-tight sm:text-5xl lg:col-span-6 lg:col-start-2 lg:row-start-2"
        >
          Everything you wear leaves a trace.
        </motion.p>

        <motion.figure
          {...rise(0.18)}
          className="lg:col-span-4 lg:col-start-9 lg:row-span-3 lg:row-start-1 lg:mt-28"
        >
          {item ? <Plate item={item} /> : <EmptyPlate pending={latest.isPending} />}
        </motion.figure>

        <motion.div {...rise(0.24)} className="max-w-md lg:col-span-4 lg:col-start-2 lg:row-start-3">
          <p className="leading-relaxed text-ink-muted">
            Keep the garments, fabrics and colours that stay with you. Thread measures each
            palette, names the craft, and finds the pieces in your archive that belong together.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/gallery">
              Enter the archive <ArrowRight aria-hidden className="size-4" />
            </ButtonLink>
            <ButtonLink href="/upload" variant="secondary">
              Add a piece
            </ButtonLink>
          </div>
        </motion.div>
      </div>

      <ol className="mt-20 grid border-t border-line sm:grid-cols-3">
        {INDEX.map((entry, i) => (
          <li key={entry.title} className="border-b border-line py-6 sm:border-b-0 sm:pr-8 sm:[&:not(:first-child)]:border-l sm:[&:not(:first-child)]:pl-8">
            <span className="font-display text-sm text-clay">0{i + 1}</span>
            <h2 className="mt-2 font-display text-2xl">{entry.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">{entry.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

const INDEX = [
  { title: "Palette", body: "Dominant colours measured in CIELAB, named, and kept with every piece." },
  { title: "Craft & form", body: "Garment, silhouette, pattern and textile traditions, from ikat to chikankari." },
  { title: "Kindred pieces", body: "Visual search across your own archive: by look, by palette, or by fabric." },
];

function Plate({ item }: { item: Item }) {
  const colours = item.palette?.colors.slice(0, 4) ?? [];
  return (
    <>
      <Link href={`/items/${item.id}`} className="group block overflow-hidden bg-paper-raised">
        {/* eslint-disable-next-line @next/next/no-img-element -- private image served by the API */}
        <img
          src={apiUrl(item.thumbnail_url)}
          alt={item.notes ? item.notes.slice(0, 120) : `The newest ${item.type} in your archive`}
          className="aspect-[4/5] w-full object-cover transition-transform sm:aspect-[3/4] duration-700 group-hover:scale-[1.02] motion-reduce:transition-none"
        />
      </Link>
      <figcaption className="mt-3 flex items-start justify-between gap-4 text-xs text-ink-muted">
        <span>
          <span className="font-display italic text-ink">Fig. 01</span> · newest in your archive · {item.type}
        </span>
        {colours.length > 0 && (
          <span role="img" className="flex shrink-0 gap-1" aria-label={`Palette: ${colours.map((c) => c.name).join(", ")}`}>
            {colours.map((c) => (
              <span key={c.hex} className="size-3 border border-ink/10" style={{ backgroundColor: c.hex }} />
            ))}
          </span>
        )}
      </figcaption>
    </>
  );
}

function EmptyPlate({ pending }: { pending: boolean }) {
  if (pending) return <div role="status" className="aspect-[4/5] w-full animate-pulse bg-ink/[0.05] sm:aspect-[3/4]" aria-label="Loading the archive" />;
  return (
    <div className="flex aspect-[4/5] w-full flex-col justify-end bg-ink p-8 text-paper sm:aspect-[3/4]">
      <p className="font-display text-3xl leading-tight">Your archive starts with one photograph.</p>
      <Link href="/upload" className="mt-6 inline-flex items-center gap-2 text-sm text-paper underline-offset-4 hover:underline">
        Add your first piece <ArrowRight aria-hidden className="size-4" />
      </Link>
    </div>
  );
}
