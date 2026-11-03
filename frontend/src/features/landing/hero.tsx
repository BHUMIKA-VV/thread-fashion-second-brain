"use client";

import { ArrowRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/brand/logo";
import { apiUrl } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { FAMILY_SWATCH } from "@/lib/colour-families";

import { BeforeAfter, ProductTour, WhyThread } from "./story-sections";
import { useLandingPieces, type LandingData, type LandingPiece } from "./use-landing-pieces";

/**
 * The landing page, in two moods. First, full-screen cover scenes: a real piece fills each
 * screen with a huge lowercase line over it, like a magazine cover or a poster. Then a quiet
 * gallery on ivory: an arched frame and a small collage. Below, a strip of pieces, the colours measured across them,
 * how Thread works, and a way in. Every image and colour is real; with nothing to show, the page
 * uses plain brand colour, never stand-in photography.
 */
export function Hero({ demoInvite, audiences }: { demoInvite?: ReactNode; audiences?: ReactNode }) {
  const data = useLandingPieces();
  // The scenes use the first three pieces; the gallery shows the next ones (or repeats, if few).
  const gallery = data.pieces.length > 3 ? data.pieces.slice(3) : data.pieces;
  return (
    <>
      <CoverScenes data={data} />
      {/* The story and the demo are for visitors; signed in, the page stays about your archive. */}
      {!data.signedIn && <BeforeAfter />}
      {!data.signedIn && <ProductTour />}
      {/* Rendered on the server (app/page.tsx), so the demo dataset never ships to the browser. */}
      {!data.signedIn && demoInvite}
      <QuietGallery data={data} framed={gallery[0]} collage={gallery.slice(1, 3)} />
      <PieceStrip data={data} />
      <ColourStory data={data} />
      <HowItWorks />
      {/* Server-rendered too (app/page.tsx): it reads the published contact address. */}
      {!data.signedIn && audiences}
      {!data.signedIn && <WhyThread />}
      <Closing signedIn={data.signedIn} />
    </>
  );
}

/** Fade-and-rise on first view; nothing moves for people who prefer reduced motion. */
function Reveal({ children, className, delay = 0, onMount = false }: { children: ReactNode; className?: string; delay?: number; onMount?: boolean }) {
  const reduce = useReducedMotion();
  const visible = { opacity: 1, y: 0 };
  // Always the same element: the server can't know the preference and renders it hidden, so
  // swapping in a plain <div> on the client would keep that hidden style after hydration.
  // With reduced motion it is simply set visible at once, with no movement.
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      {...(reduce || onMount ? { animate: visible } : { whileInView: visible, viewport: { once: true, margin: "-10% 0px" } })}
      transition={reduce ? { duration: 0 } : { duration: 0.8, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

const onPhotoPrimary =
  "inline-flex items-center gap-2 rounded-[2px] bg-paper-raised px-5 py-2.5 text-sm font-medium tracking-[0.02em] text-ink transition-colors hover:bg-paper";
const onPhotoSecondary =
  "inline-flex items-center gap-2 rounded-[2px] border border-paper-raised/80 px-5 py-2.5 text-sm font-medium tracking-[0.02em] text-paper-raised transition-colors hover:bg-paper-raised/10";

// --- A · cover scenes ------------------------------------------------------------------------
//
// Full-screen scenes, one real piece each, with a huge lowercase line about one thing Thread
// does. Each scene sticks while the next slides up over it (plain CSS: scrolling is never
// taken over, and with reduced motion they simply stack).

const SCENE =
  "sticky top-0 isolate flex min-h-[560px] items-end overflow-hidden bg-ink text-paper-raised motion-reduce:static";
// The first scene sits under the site header, so it is one header shorter than the screen.
const FIRST_SCENE_HEIGHT = "h-[calc(100svh-7.5rem)] sm:h-[calc(100svh-5.25rem)]";

function CoverScenes({ data }: { data: LandingData }) {
  const [first, second, third] = data.pieces;
  return (
    <div>
      <Scene piece={first} pending={data.pending} fallback="indigo" label="Thread" className={FIRST_SCENE_HEIGHT}>
        <h1 className="max-w-[200px] sm:max-w-[260px]">
          <Logo height={90} fluid priority tone="light" label="Thread" />
        </h1>
        <Headline>
          <span className="block">
            everything you <em>wear</em>
          </span>{" "}
          <span className="block">leaves a trace.</span>
        </Headline>
        {/* What Thread is, in plain words, before any scrolling. */}
        <p className="mt-6 max-w-xl text-base leading-relaxed text-paper-raised/90 sm:text-lg">
          A visual archive for fashion and textiles. Photograph a piece: Thread measures its colours, suggests
          its craft and finds kindred pieces.
        </p>
        <div className="mt-8 flex flex-wrap items-end justify-between gap-6">
          <div className="flex flex-wrap gap-3">
            {data.signedIn ? (
              <>
                <Link href="/gallery" className={onPhotoPrimary}>
                  Enter the archive <ArrowRight aria-hidden className="size-4" />
                </Link>
                <Link href="/upload" className={onPhotoSecondary}>
                  Add a piece
                </Link>
              </>
            ) : (
              <>
                <Link href="/demo" className={onPhotoPrimary}>
                  Explore Thread <ArrowRight aria-hidden className="size-4" />
                </Link>
                <Link href="/signup" className={onPhotoSecondary}>
                  Create your wardrobe
                </Link>
              </>
            )}
          </div>
          {first && <CoverCaption piece={first} figure="01" note={`newest in ${data.source}`} />}
        </div>
      </Scene>

      <Scene piece={second} pending={data.pending} fallback="clay" label="Every colour, measured" className="h-[100svh]">
        <SceneRow
          headline={
            <>
              <span className="block">every colour,</span> <span className="block italic">measured.</span>
            </>
          }
          aside="Each photograph is read in CIELAB, the colour space closest to how eyes see, and its dominant colours are named and kept."
        />
        {second && second.colours.length > 0 && (
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-3" aria-label="Measured colours of this piece">
            {second.colours.slice(0, 5).map((c) => (
              <li key={c.hex} className="flex items-center gap-3">
                <span aria-hidden className="size-10 border border-paper-raised/40 sm:size-12" style={{ backgroundColor: c.hex }} />
                <span className="text-sm leading-tight">
                  <span className="block capitalize">{c.name}</span>
                  <span className="block font-mono text-xs text-paper-raised/75">
                    {c.hex.toUpperCase()} · {Math.round(c.percentage)}%
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {second && <CoverCaption piece={second} figure="02" note={`from ${data.source}`} className="mt-8" />}
      </Scene>

      <Scene piece={third} pending={data.pending} fallback="sage" label="Craft and kindred pieces" className="h-[100svh]">
        <SceneRow
          headline={
            <>
              <span className="block">craft &amp;</span> <span className="block italic">kindred pieces.</span>
            </>
          }
          aside="Thread suggests the craft it sees, from ikat to chikankari, labelled as a suggestion you can correct, and finds the pieces that belong together: by look, by palette or by fabric."
        />
        {third && <CoverCaption piece={third} figure="03" note={`from ${data.source}`} className="mt-8" />}
      </Scene>
    </div>
  );
}

function Scene({
  piece,
  pending,
  fallback,
  label,
  className,
  children,
}: {
  piece?: LandingPiece;
  pending: boolean;
  fallback: "indigo" | "clay" | "sage";
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className={cn(SCENE, className)}>
      {pending ? (
        <div role="status" aria-label="Loading" className="absolute inset-0 -z-10 animate-pulse bg-paper-raised/5" />
      ) : piece ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- served by the API */}
          <img src={apiUrl(piece.image)} alt={piece.alt} className="absolute inset-0 -z-20 size-full object-cover" />
          {/* Darkest behind the type, so it stays readable on any photograph. */}
          <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-ink/85 via-ink/55 to-ink/25" />
        </>
      ) : (
        // No piece for this scene: brand colour, never stand-in photography.
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 -z-10",
            fallback === "indigo" ? "bg-indigo" : fallback === "clay" ? "bg-[#7d3826]" : "bg-[#4f5440]",
          )}
        />
      )}
      <div className="mx-auto w-full max-w-7xl px-4 pb-10 pt-16 sm:px-8 sm:pb-14">
        <Reveal>{children}</Reveal>
      </div>
    </section>
  );
}

/** The huge lowercase line: Fraunces at poster scale. */
function Headline({ as: Tag = "p", children, className }: { as?: "p" | "h2"; children: ReactNode; className?: string }) {
  return (
    <Tag
      className={cn(
        "mt-5 font-display text-[clamp(2.75rem,8.5vw,8rem)] font-normal lowercase leading-[0.9] tracking-[-0.03em]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

function SceneRow({ headline, aside }: { headline: ReactNode; aside: string }) {
  return (
    <div className="grid items-end gap-6 lg:grid-cols-12">
      <Headline as="h2" className="lg:col-span-9">{headline}</Headline>
      <p className="max-w-xs text-sm leading-relaxed text-paper-raised/90 lg:col-span-3 lg:justify-self-end lg:text-right">
        {aside}
      </p>
    </div>
  );
}

function CoverCaption({
  piece,
  figure,
  note,
  className,
}: {
  piece: LandingPiece;
  figure: string;
  note: string;
  className?: string;
}) {
  const chips = piece.colours.slice(0, 4);
  return (
    <Link href={piece.href} className={cn("group inline-flex items-center gap-3 text-xs text-paper-raised/90", className)}>
      <span>
        <span className="font-display text-sm italic text-paper-raised">Fig. {figure}</span> · {note} · {piece.type}
      </span>
      {chips.length > 0 && (
        <span role="img" aria-label={`Palette: ${chips.map((c) => c.name).join(", ")}`} className="flex gap-1">
          {chips.map((c) => (
            <span key={c.hex} className="size-3 border border-paper-raised/40" style={{ backgroundColor: c.hex }} />
          ))}
        </span>
      )}
      <ArrowRight aria-hidden className="size-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
    </Link>
  );
}

// --- C · quiet gallery ------------------------------------------------------------------------

function QuietGallery({ data, framed, collage }: { data: LandingData; framed?: LandingPiece; collage: LandingPiece[] }) {
  return (
    <section aria-labelledby="keep-title" className="mx-auto grid w-full max-w-7xl items-center gap-12 px-4 py-20 sm:px-8 sm:py-28 lg:grid-cols-12">
      <Reveal className="lg:col-span-5">
        <p className="text-[11px] uppercase tracking-[0.3em] text-ink-muted">Garments · Fabrics · Colour · Craft</p>
        <h2 id="keep-title" className="mt-5 text-balance font-display text-5xl italic leading-[1.02] tracking-tight sm:text-6xl">
          Keep what stays with you
        </h2>
        <p className="mt-6 max-w-md leading-relaxed text-ink-muted">
          Photograph a garment, a fabric or a detail you love. Thread measures its palette, suggests the craft
          and finds the pieces in your archive that belong with it.
        </p>
        <Link
          href={data.signedIn ? "/colour-lab" : "/showcase"}
          className="mt-8 inline-flex items-center gap-2 border-b border-ink pb-1 text-sm font-medium"
        >
          {data.signedIn ? "Open the Colour Lab" : "Browse the showcase"} <ArrowRight aria-hidden className="size-4" />
        </Link>
      </Reveal>

      <Reveal delay={0.1} className="relative mx-auto aspect-[4/5] w-full max-w-md lg:col-span-6 lg:col-start-7">
        {/* The arched frame */}
        <div className="absolute inset-x-[12%] bottom-0 top-0 overflow-hidden rounded-t-full bg-line">
          {framed && (
            <Link href={framed.href} className="block size-full">
              {/* eslint-disable-next-line @next/next/no-img-element -- served by the API */}
              <img src={apiUrl(framed.thumbnail)} alt={framed.alt} loading="lazy" className="size-full object-cover" />
            </Link>
          )}
        </div>
        {/* The collage: two more real pieces, or quiet brand colour */}
        <CollageTile piece={collage[0]} className="absolute -right-2 bottom-[8%] w-[34%] sm:right-0" fallback="bg-sage" />
        <CollageTile piece={collage[1]} className="absolute -left-2 bottom-[-4%] w-[26%] sm:left-0" fallback="bg-indigo" />
      </Reveal>
    </section>
  );
}

function CollageTile({ piece, className, fallback }: { piece?: LandingPiece; className: string; fallback: string }) {
  if (!piece) return <div aria-hidden className={cn("aspect-square", fallback, className)} />;
  return (
    <Link href={piece.href} className={cn("block aspect-square overflow-hidden border-4 border-paper", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- served by the API */}
      <img src={apiUrl(piece.thumbnail)} alt={piece.alt} loading="lazy" className="size-full object-cover" />
    </Link>
  );
}

// --- the strip, the colour story, how it works, the way in ----------------------------------

function PieceStrip({ data }: { data: LandingData }) {
  if (data.pieces.length < 2) return null;
  return (
    <section aria-labelledby="strip-title" className="border-y border-line bg-paper-raised py-14">
      <div className="mx-auto flex max-w-7xl items-baseline justify-between gap-4 px-4 sm:px-8">
        <h2 id="strip-title" className="font-display text-3xl tracking-tight">
          From {data.source}
        </h2>
        <Link href={data.signedIn ? "/gallery" : "/showcase"} className="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline">
          See everything
        </Link>
      </div>
      <ul
        tabIndex={0}
        aria-label={`Pieces from ${data.source}`}
        className="mx-auto mt-8 flex max-w-7xl snap-x scroll-pl-4 gap-4 overflow-x-auto px-4 pb-2 sm:scroll-pl-8 sm:px-8"
      >
        {data.pieces.map((piece) => (
          <li key={piece.id} className="w-44 shrink-0 snap-start sm:w-56">
            <Link href={piece.href} className="group block">
              <span className="block aspect-[3/4] overflow-hidden bg-paper">
                {/* eslint-disable-next-line @next/next/no-img-element -- served by the API */}
                <img
                  src={apiUrl(piece.thumbnail)}
                  alt={piece.alt}
                  loading="lazy"
                  className="size-full object-cover transition-transform duration-700 group-hover:scale-[1.03] motion-reduce:transition-none"
                />
              </span>
              <span aria-hidden className="flex h-1.5">
                {piece.colours.map((c) => (
                  <span key={c.hex} style={{ backgroundColor: c.hex, width: `${c.percentage}%` }} />
                ))}
              </span>
              <span className="mt-2 block text-[11px] uppercase tracking-[0.2em] text-ink-muted">{piece.type}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ColourStory({ data }: { data: LandingData }) {
  if (data.families.length === 0) return null;
  const total = data.families.reduce((sum, f) => sum + f.items, 0);
  return (
    <section aria-labelledby="colour-title" className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-8">
      <Reveal>
        <h2 id="colour-title" className="font-display text-3xl tracking-tight">
          The colours of {data.source}
        </h2>
        <p className="mt-2 text-sm text-ink-muted">Measured from every photograph, not chosen by hand. Choose one to see its pieces.</p>
      </Reveal>
      <Reveal delay={0.08}>
        <ul className="mt-8 flex h-28 overflow-hidden sm:h-36" aria-label="Colour families">
          {data.families.map((f) => (
            <li key={f.family} style={{ width: `${(f.items / total) * 100}%` }} className="min-w-6">
              <Link
                href={data.familyHref(f.family)}
                className="group flex size-full items-end border-r border-paper/40 p-2"
                style={{ backgroundColor: FAMILY_SWATCH[f.family] }}
              >
                <span className="sr-only">
                  {f.family} {f.items} {f.items === 1 ? "piece" : "pieces"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted" aria-hidden>
          {data.families.map((f) => (
            <li key={f.family} className="flex items-center gap-1.5 capitalize">
              <span className="size-2.5 border border-ink/15" style={{ backgroundColor: FAMILY_SWATCH[f.family] }} />
              {f.family} {f.items}
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  );
}

const STEPS = [
  { title: "Palette", body: "Dominant colours measured in CIELAB, named, and kept with every piece." },
  { title: "Craft & form", body: "Suggested garment, silhouette, pattern and craft, from ikat to chikankari, marked as suggestions you can correct." },
  { title: "Kindred pieces", body: "Visual search across your own archive: by look, by palette, or by fabric." },
];

function HowItWorks() {
  return (
    <section aria-label="How Thread works" className="mx-auto w-full max-w-7xl px-4 pb-20 sm:px-8">
      <ol className="grid border-t border-ink sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className="border-b border-line py-8 sm:border-b-0 sm:pr-8 sm:[&:not(:first-child)]:border-l sm:[&:not(:first-child)]:pl-8">
            <Reveal delay={i * 0.08}>
              <span className="font-display text-sm text-clay">0{i + 1}</span>
              <h2 className="mt-2 font-display text-2xl">{step.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{step.body}</p>
            </Reveal>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Closing({ signedIn }: { signedIn: boolean }) {
  return (
    <section aria-labelledby="closing-title" className="bg-ink text-paper-raised">
      <div className="mx-auto flex max-w-7xl flex-col items-start gap-8 px-4 py-20 sm:flex-row sm:items-end sm:justify-between sm:px-8">
        <h2 id="closing-title" className="max-w-2xl text-balance font-display text-4xl italic leading-tight sm:text-5xl">
          {signedIn ? "Add the next piece to your archive." : "Your archive starts with one photograph."}
        </h2>
        {signedIn ? (
          <Link href="/upload" className={onPhotoPrimary}>
            Upload a photograph <ArrowRight aria-hidden className="size-4" />
          </Link>
        ) : (
          // The way in, in order: look around first, then start your own, or come back to it.
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <Link href="/demo" className={onPhotoPrimary}>
              Explore the demo <ArrowRight aria-hidden className="size-4" />
            </Link>
            <Link href="/signup" className={onPhotoSecondary}>
              Create your wardrobe
            </Link>
            <Link href="/try" className="text-sm text-paper-raised/90 underline underline-offset-4 hover:text-paper-raised">
              Try it on a photo
            </Link>
            <Link href="/login" className="text-sm text-paper-raised/90 underline underline-offset-4 hover:text-paper-raised">
              Sign in
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
