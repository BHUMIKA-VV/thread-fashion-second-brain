import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

/**
 * The landing page's story for visitors: what changes when you keep an archive, who Thread
 * is for and why. Every claim here is something Thread does today (see /how-it-works);
 * nothing is a testimonial or a promise of future features.
 */

const BEFORE_AFTER = [
  {
    before: "Fashion photos scattered across a camera roll, chats and screenshots",
    after: "One private archive of garments, fabrics, accessories and details",
  },
  {
    before: "“That red, but which red?”",
    after: "A measured palette for every piece: named colours, hex values and how much each covers",
  },
  {
    before: "Scrolling back for the ikat you photographed months ago",
    after: "Search by colour, craft or type, and kindred pieces by look, palette or fabric",
  },
  {
    before: "Looks that stay in your head",
    after: "Outfits composed in the Studio, with the colours they share and contrast",
  },
  {
    before: "Guesses that read like facts",
    after: "Model suggestions marked as such; the weave and your corrections recorded by you",
  },
] as const;

export function BeforeAfter() {
  return (
    <section aria-labelledby="before-after-title" className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-8">
      <p className="text-[11px] uppercase tracking-[0.3em] text-ink-muted">Before · After</p>
      <h2 id="before-after-title" className="mt-4 max-w-2xl text-balance font-display text-4xl leading-tight tracking-tight sm:text-5xl">
        From scattered photos to an archive you can read
      </h2>
      <ul className="mt-10 border-t border-ink">
        {BEFORE_AFTER.map((row) => (
          <li key={row.after} className="grid gap-2 border-b border-line py-5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-baseline sm:gap-6">
            <p className="text-ink-muted">
              <span className="sr-only">Before: </span>
              {row.before}
            </p>
            <ArrowRight aria-hidden className="hidden size-4 text-clay sm:block" />
            <p>
              <span className="sr-only">With Thread: </span>
              {row.after}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Screenshots of the real app (e2e/capture-screenshots.spec.ts), with the demo's museum pieces. */
const SHOTS = [
  {
    src: "/screens/palette.webp",
    width: 1440,
    height: 900,
    title: "A piece and its palette",
    caption: "Named colours, hex values and how much of the photograph each covers.",
    wide: true,
  },
  {
    src: "/screens/similar.webp",
    width: 1088,
    height: 930,
    title: "Kindred pieces",
    caption: "Ranked by look, by shared palette, or by fabric in another colour.",
  },
  {
    src: "/screens/textile-record.webp",
    width: 426,
    height: 663,
    title: "A textile record",
    caption: "Weave and craft you record yourself, beside the model's labelled suggestions.",
  },
  {
    src: "/screens/gallery.webp",
    width: 1440,
    height: 900,
    title: "The archive",
    caption: "Search by tag or note, filter by colour family and type.",
  },
  {
    src: "/screens/outfit-studio.webp",
    width: 1440,
    height: 900,
    title: "The Outfit Studio",
    caption: "Compose looks from your pieces and see the colours they share.",
  },
] as const;

export function ProductTour() {
  return (
    <section aria-labelledby="tour-title" className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-8">
      <p className="text-[11px] uppercase tracking-[0.3em] text-ink-muted">The app itself</p>
      <h2 id="tour-title" className="mt-4 max-w-2xl text-balance font-display text-4xl leading-tight tracking-tight sm:text-5xl">
        What an archive looks like
      </h2>
      <p className="mt-4 max-w-2xl text-ink-muted">
        Unretouched screenshots of Thread, taken with public-domain museum pieces uploaded like any photograph.
      </p>
      <div className="mt-10 grid gap-x-8 gap-y-12 md:grid-cols-2">
        {SHOTS.map((shot) => (
          <figure key={shot.src} className={"wide" in shot ? "md:col-span-2" : undefined}>
            <div className="overflow-hidden border border-line bg-paper-raised">
              <Image
                src={shot.src}
                alt={`Screenshot: ${shot.title.toLowerCase()} in Thread`}
                width={shot.width}
                height={shot.height}
                sizes={"wide" in shot ? "(min-width: 1280px) 1216px, 100vw" : "(min-width: 768px) 50vw, 100vw"}
                // A portrait shot is centred at its own size rather than stretched across the column.
                className={shot.height > shot.width ? "mx-auto h-auto max-h-[36rem] w-auto max-w-full" : "h-auto w-full"}
              />
            </div>
            <figcaption className="mt-3">
              <span className="font-display text-xl">{shot.title}</span>
              <span className="mt-1 block text-sm text-ink-muted">{shot.caption}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

const AUDIENCES = [
  {
    title: "Fashion enthusiasts",
    body: "Keep the pieces you own and the ones you love in one place, and find them again by colour.",
  },
  {
    title: "Stylists",
    body: "Gather references into collections and try combinations in the Outfit Studio, with their colours side by side.",
  },
  {
    title: "Designers",
    body: "Pull exact hex values from a photograph and find pieces with a kindred palette or fabric.",
  },
  {
    title: "Textile collectors",
    body: "Record weave, craft and notes for each piece, alongside a palette measured from the photograph.",
  },
] as const;

export function WhoFor() {
  return (
    <section aria-labelledby="who-title" className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-8">
      <h2 id="who-title" className="font-display text-4xl tracking-tight">
        Who Thread is for
      </h2>
      <ul className="mt-8 grid border-t border-ink sm:grid-cols-2 lg:grid-cols-4">
        {AUDIENCES.map((a) => (
          <li key={a.title} className="border-b border-line py-6 sm:pr-6 lg:border-b-0 lg:[&:not(:first-child)]:border-l lg:[&:not(:first-child)]:pl-6">
            <h3 className="font-display text-2xl">{a.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">{a.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const REASONS = [
  {
    title: "Private by default",
    body: "Your archive is visible only to your account. No ads, no tracking.",
  },
  {
    title: "Measured, not invented",
    body: "Colours come from the pixels of your photograph. If they can't be measured, Thread shows none rather than guessing.",
  },
  {
    title: "Honest about guesses",
    body: "Tags from the image model are labelled as suggestions, and fabric is only ever a guess from a photo.",
  },
  {
    title: "Nothing leaves without asking",
    body: "The image model runs on Thread's own server. Optional deep analysis says what it will send and waits for you.",
  },
] as const;

export function WhyThread() {
  return (
    <section aria-labelledby="why-title" className="mx-auto w-full max-w-7xl px-4 pb-20 sm:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 id="why-title" className="font-display text-4xl tracking-tight">
          Why Thread
        </h2>
        <Link href="/how-it-works" className="text-sm text-ink-muted underline underline-offset-4 hover:text-ink">
          How it works
        </Link>
      </div>
      <dl className="mt-8 grid gap-x-8 gap-y-6 border-t border-ink pt-6 sm:grid-cols-2">
        {REASONS.map((r) => (
          <div key={r.title}>
            <dt className="font-display text-xl">{r.title}</dt>
            <dd className="mt-1 text-sm leading-relaxed text-ink-muted">{r.body}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
