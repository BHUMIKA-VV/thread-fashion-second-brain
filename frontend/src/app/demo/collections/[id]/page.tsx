import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { JsonLd } from "@/components/json-ld";
import { PAGE, PageHeader } from "@/components/page-header";
import { DEMO, demoAsset, demoCollection, demoPiece, demoPieces, pieceAlt } from "@/features/demo/demo-data";
import { DemoTile } from "@/features/demo/demo-tile";
import { shareMetadata } from "@/lib/site";
import { demoCollectionData } from "@/lib/structured-data";

export function generateStaticParams() {
  return DEMO.collections.map((c) => ({ id: c.id }));
}

export async function generateMetadata({ params }: PageProps<"/demo/collections/[id]">): Promise<Metadata> {
  const collection = demoCollection((await params).id);
  if (!collection) return { title: "Demo collection" };
  const title = `${collection.title} · Demo`;
  const description = collection.description ?? `A sample collection of ${collection.pieces.length} public-domain pieces in Thread's read-only demo.`;
  const cover = demoPiece(collection.pieces[0]);
  const image = cover && { url: demoAsset(cover.image), alt: pieceAlt(cover) };
  return { title, description, ...shareMetadata({ title, description, path: `/demo/collections/${collection.id}`, image }) };
}

export default async function DemoCollectionPage({ params }: PageProps<"/demo/collections/[id]">) {
  const collection = demoCollection((await params).id);
  if (!collection) notFound();
  const pieces = demoPieces(collection.pieces);
  return (
    <div className={PAGE}>
      <JsonLd data={demoCollectionData(collection)} />
      <Link href="/demo" className="mb-6 inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" /> Demo
      </Link>
      <PageHeader kicker={`Demo collection · ${pieces.length} pieces`} title={collection.title} description={collection.description} />
      <ul aria-label={`${collection.title} pieces`} className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
        {pieces.map((piece) => (
          <li key={piece.id}>
            <DemoTile piece={piece} />
          </li>
        ))}
      </ul>
    </div>
  );
}
