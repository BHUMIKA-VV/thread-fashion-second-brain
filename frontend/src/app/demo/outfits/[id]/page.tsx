import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PAGE, PageHeader } from "@/components/page-header";
import { DEMO, demoAsset, demoOutfit, demoPiece, demoPieces, pieceAlt } from "@/features/demo/demo-data";
import { OutfitSwatch } from "@/features/demo/demo-sections";
import { DemoTile } from "@/features/demo/demo-tile";
import { shareMetadata } from "@/lib/site";

export function generateStaticParams() {
  return DEMO.outfits.map((o) => ({ id: o.id }));
}

export async function generateMetadata({ params }: PageProps<"/demo/outfits/[id]">): Promise<Metadata> {
  const outfit = demoOutfit((await params).id);
  if (!outfit) return { title: "Demo outfit" };
  const title = `${outfit.title} · Demo`;
  const description = `A sample outfit of ${outfit.pieces.length} public-domain pieces in Thread's read-only demo, with the colours they share and contrast.`;
  const cover = demoPiece(outfit.pieces[0]);
  const image = cover && { url: demoAsset(cover.image), alt: pieceAlt(cover) };
  return { title, description, ...shareMetadata({ title, description, path: `/demo/outfits/${outfit.id}`, image }) };
}

export default async function DemoOutfitPage({ params }: PageProps<"/demo/outfits/[id]">) {
  const outfit = demoOutfit((await params).id);
  if (!outfit) notFound();
  const pieces = demoPieces(outfit.pieces);
  const { dominant, shared, contrasting } = outfit.colours;
  return (
    <div className={PAGE}>
      <Link href="/demo" className="mb-6 inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" /> Demo
      </Link>
      <PageHeader kicker={`Demo outfit · ${pieces.length} pieces`} title={outfit.title} description={outfit.note} />
      <div className="mt-10 grid gap-12 lg:grid-cols-12">
        <ul aria-label={`${outfit.title} pieces`} className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:col-span-8">
          {pieces.map((piece) => (
            <li key={piece.id}>
              <DemoTile piece={piece} sizes="(min-width: 1024px) 20vw, (min-width: 640px) 33vw, 50vw" />
            </li>
          ))}
        </ul>

        <section aria-labelledby="outfit-colours" className="self-start border-t border-ink pt-5 lg:col-span-4">
          <h2 id="outfit-colours" className="font-display text-xl">
            Outfit colours
          </h2>
          <div
            className="mt-4 flex h-10 overflow-hidden"
            role="img"
            aria-label={`Main colours: ${dominant.map((c) => `${c.name} ${Math.round(c.share)}%`).join(", ")}`}
          >
            {dominant.map((c) => (
              <span key={c.hex} style={{ backgroundColor: c.hex, flexGrow: c.share }} className="min-w-0.5 basis-0" />
            ))}
          </div>
          <ul className="mt-4 space-y-2 text-sm">
            {dominant.map((c) => (
              <li key={c.hex} className="flex items-center justify-between gap-3">
                <OutfitSwatch colour={c} />
                <span className="font-mono text-xs text-ink-muted">{Math.round(c.share)}%</span>
              </li>
            ))}
          </ul>
          {shared.length > 0 && (
            <>
              <h3 className="mt-6 text-sm font-medium">Shared between pieces</h3>
              <ul className="mt-2 space-y-2 text-sm">
                {shared.map((c) => (
                  <li key={c.hex}>
                    <OutfitSwatch colour={c} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {contrasting.length > 0 && (
            <>
              <h3 className="mt-6 text-sm font-medium">Light and dark contrasts</h3>
              <ul className="mt-2 space-y-2 text-sm">
                {contrasting.slice(0, 3).map(([a, b]) => (
                  <li key={`${a.hex}${b.hex}`} className="flex flex-wrap items-center gap-2">
                    <OutfitSwatch colour={a} /> <span className="text-ink-muted">with</span> <OutfitSwatch colour={b} />
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-6 text-xs text-ink-muted">
            Combined from each piece&apos;s measured palette, weighted equally per piece.
          </p>
        </section>
      </div>
    </div>
  );
}
