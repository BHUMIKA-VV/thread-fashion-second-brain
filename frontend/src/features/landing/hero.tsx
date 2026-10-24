"use client";

import { ArrowRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { ButtonLink } from "@/components/ui/button";

// Decorative colour strip for the landing page. It is not analysis output.
const SWATCHES = [
  { hex: "#B4654A", name: "Terracotta" },
  { hex: "#C49A45", name: "Haldi" },
  { hex: "#7D8466", name: "Mehendi" },
  { hex: "#3E4A6B", name: "Indigo" },
  { hex: "#E9DFCF", name: "Undyed cotton" },
  { hex: "#22201C", name: "Kohl" },
];

export function Hero() {
  const reduceMotion = useReducedMotion();
  const rise = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 16 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    <section className="mx-auto w-full max-w-6xl px-5 pb-16 pt-20 sm:px-8 sm:pt-28">
      <motion.p {...rise(0)} className="text-xs uppercase tracking-[0.3em] text-ink-muted">
        A second brain for what you wear
      </motion.p>
      <motion.h1
        {...rise(0.08)}
        className="mt-6 max-w-3xl font-display text-5xl leading-[1.05] tracking-tight sm:text-7xl"
      >
        Every colour, weave and silhouette you love, <em className="text-clay">remembered</em>.
      </motion.h1>
      <motion.p {...rise(0.16)} className="mt-6 max-w-xl text-lg leading-relaxed text-ink-muted">
        Save outfits, garments and fabric swatches. Thread reads their palette, tags the craft —
        from ikat to houndstooth — and finds kindred pieces in your own library.
      </motion.p>
      <motion.div {...rise(0.24)} className="mt-10 flex flex-wrap gap-3">
        <ButtonLink href="/upload">
          Start uploading <ArrowRight aria-hidden className="size-4" />
        </ButtonLink>
        <ButtonLink href="/gallery" variant="secondary">
          Browse your gallery
        </ButtonLink>
      </motion.div>

      <motion.ul
        {...rise(0.34)}
        aria-hidden
        className="mt-20 grid grid-cols-3 overflow-hidden rounded-2xl border border-line shadow-soft sm:grid-cols-6"
      >
        {SWATCHES.map((swatch) => (
          <li key={swatch.hex} className="flex flex-col">
            <span className="h-28 sm:h-40" style={{ backgroundColor: swatch.hex }} />
            <span className="bg-paper-raised px-3 py-2 text-xs">
              <span className="block font-medium">{swatch.name}</span>
              <span className="font-mono text-ink-muted">{swatch.hex}</span>
            </span>
          </li>
        ))}
      </motion.ul>
    </section>
  );
}
