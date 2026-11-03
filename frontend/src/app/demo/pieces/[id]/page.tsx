import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { JsonLd } from "@/components/json-ld";
import { DEMO, demoAsset, demoPiece, pieceAlt } from "@/features/demo/demo-data";
import { DemoNotice } from "@/features/demo/demo-notice";
import { DemoCredit, DemoKindred, DemoPalette, DemoTags } from "@/features/demo/demo-sections";
import { shareMetadata } from "@/lib/site";
import { demoPieceData } from "@/lib/structured-data";

// Every piece is prerendered; any other id renders notFound() (a 404).
export function generateStaticParams() {
  return DEMO.pieces.map((p) => ({ id: p.id }));
}

export async function generateMetadata({ params }: PageProps<"/demo/pieces/[id]">): Promise<Metadata> {
  const piece = demoPiece((await params).id);
  if (!piece) return { title: "Demo piece" };
  const title = `${piece.title} · Demo`;
  const description = `A public-domain museum piece in Thread's read-only demo, with the colour palette measured from its photograph, its tags and kindred pieces.`;
  return {
    title,
    description,
    ...shareMetadata({ title, description, path: `/demo/pieces/${piece.id}`, image: { url: demoAsset(piece.image), alt: pieceAlt(piece) } }),
  };
}

export default async function DemoPiecePage({ params }: PageProps<"/demo/pieces/[id]">) {
  const piece = demoPiece((await params).id);
  if (!piece) notFound();
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-8 sm:py-16">
      <JsonLd data={demoPieceData(piece)} />
      <Link href="/demo" className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" /> Demo
      </Link>
      <div className="mt-6 grid gap-10 lg:grid-cols-12 lg:gap-12">
        <figure className="self-start lg:sticky lg:top-8 lg:col-span-7">
          <div className="bg-paper-raised">
            <Image
              src={demoAsset(piece.image)}
              alt={pieceAlt(piece)}
              width={piece.width}
              height={piece.height}
              sizes="(min-width: 1024px) 55vw, 100vw"
              priority
              className="h-auto w-full"
            />
          </div>
          <figcaption className="mt-3 text-xs text-ink-muted">{piece.title}</figcaption>
        </figure>

        <div className="min-w-0 space-y-10 lg:col-span-5">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-ink-muted">{piece.type} · Demo piece</p>
            <h1 className="mt-3 text-balance font-display text-4xl leading-tight tracking-tight">{piece.title}</h1>
          </div>
          <DemoNotice />
          {piece.palette.length > 0 && <DemoPalette colours={piece.palette} />}
          <DemoTags piece={piece} />
          <DemoCredit piece={piece} />
        </div>
      </div>
      <DemoKindred piece={piece} />
    </div>
  );
}
