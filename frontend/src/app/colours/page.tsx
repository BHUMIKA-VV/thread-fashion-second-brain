import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { JsonLd } from "@/components/json-ld";
import { PAGE, PageHeader } from "@/components/page-header";
import { ButtonLink } from "@/components/ui/button";
import { COLOUR_NAMES, MEANINGS, type IndianColour } from "@/features/colours/colours";
import { demoAsset, demoPiece } from "@/features/demo/demo-data";
import { shareMetadata } from "@/lib/site";
import { colourNamesData } from "@/lib/structured-data";

const DESCRIPTION =
  "Twenty-six Indian colour names, from haldi yellow to kajal black, with their hex values, what each word means, and museum textiles whose measured colours come close.";

export const metadata: Metadata = {
  title: "Indian colour names",
  description: DESCRIPTION,
  ...shareMetadata({ title: "Indian colour names · Thread", description: DESCRIPTION, path: "/colours" }),
};

export default function ColoursPage() {
  const { colours, max_distance, min_share } = COLOUR_NAMES;
  return (
    <div className={PAGE}>
      <JsonLd data={colourNamesData()} />
      <PageHeader
        kicker="Colour reference"
        title="Indian colour names"
        description="The shades Thread uses to name colours in Indian dress and textiles, from haldi yellow to kajal black."
      />

      <div className="mt-8 max-w-3xl space-y-3 leading-relaxed text-ink-muted">
        <p>
          When Thread measures a photo, each colour gets the name of the nearest reference shade: these twenty-six,
          and 949 English names from the xkcd colour survey. The hex values here are representative
          shades for each name, not a standard; the same word covers a range of real dyes and fabrics.
        </p>
        <p>
          Under each name are the pieces in the{" "}
          <Link href="/demo" className="text-ink underline underline-offset-4">
            demo
          </Link>{" "}
          that have a measured colour close to it: covering at least {min_share}% of the photo and within{" "}
          {max_distance} on the CIEDE2000 colour-difference scale, where under about 2 is hard to tell apart. Where
          none is that close, it says so.
        </p>
      </div>

      <nav aria-label="Colour names" className="mt-8 flex flex-wrap gap-2">
        {colours.map((c) => (
          <a
            key={c.slug}
            href={`#${c.slug}`}
            className="inline-flex items-center gap-2 rounded-[2px] border border-line bg-paper-raised px-2.5 py-1.5 text-sm capitalize hover:border-ink/40"
          >
            <span aria-hidden className="size-3.5 border border-ink/10" style={{ backgroundColor: c.hex }} />
            {c.name}
          </a>
        ))}
      </nav>

      <ul className="mt-12 border-t border-ink">
        {colours.map((c) => (
          <Colour key={c.slug} colour={c} />
        ))}
      </ul>

      <section aria-labelledby="try-title" className="mt-16 border-y border-line bg-paper-raised px-5 py-10 sm:px-8">
        <h2 id="try-title" className="font-display text-3xl tracking-tight">
          Which of these is in your photo?
        </h2>
        <p className="mt-3 max-w-2xl leading-relaxed text-ink-muted">
          Try one photo of a sari, a kurta or a fabric: Thread measures its colours and names each one, with no account.
        </p>
        <ButtonLink href="/try" className="mt-6">
          Try a photo <ArrowRight aria-hidden className="size-4" />
        </ButtonLink>
      </section>
    </div>
  );
}

function Colour({ colour: c }: { colour: IndianColour }) {
  return (
    <li id={c.slug} className="grid scroll-mt-24 gap-x-8 gap-y-5 border-b border-line py-8 sm:grid-cols-12">
      <div className="flex gap-5 sm:col-span-4">
        <span aria-hidden className="size-20 shrink-0 border border-ink/10" style={{ backgroundColor: c.hex }} />
        <div>
          <h2 className="font-display text-2xl capitalize leading-tight">{c.name}</h2>
          <p className="mt-1 font-mono text-xs text-ink-muted">
            {c.hex.toUpperCase()} · {c.family}
          </p>
          <p className="mt-2 text-sm text-ink-muted">{MEANINGS[c.name]}</p>
        </div>
      </div>
      <div className="sm:col-span-8">
        {c.pieces.length === 0 ? (
          <p className="text-sm text-ink-muted">No demo piece has a colour this close yet.</p>
        ) : (
          <ul aria-label={`Demo pieces close to ${c.name}`} className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {c.pieces.map((m) => {
              const piece = demoPiece(m.piece);
              return piece ? (
                <li key={m.piece}>
                  <Link href={`/demo/pieces/${piece.id}`} className="group block">
                    <span className="relative block aspect-[3/4] overflow-hidden bg-paper-raised">
                      <Image src={demoAsset(piece.thumbnail)} alt={piece.title} fill sizes="(min-width: 1024px) 8vw, 25vw" className="object-cover" />
                    </span>
                    <span aria-hidden className="block h-1.5" style={{ backgroundColor: m.hex }} />
                    <span className="mt-1 block truncate text-xs text-ink group-hover:underline">{piece.title}</span>
                  </Link>
                  <p className="font-mono text-[11px] text-ink-muted">
                    {m.name} · {Math.round(m.share)}% · ΔE {m.distance.toFixed(1)}
                  </p>
                </li>
              ) : null;
            })}
          </ul>
        )}
      </div>
    </li>
  );
}
