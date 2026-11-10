import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PAGE, PageHeader } from "@/components/page-header";
import { DemoBoardView } from "@/features/demo/demo-board";
import { DEMO, demoAsset, demoBoard, demoPiece, pieceAlt } from "@/features/demo/demo-data";
import { shareMetadata } from "@/lib/site";

export function generateStaticParams() {
  return DEMO.boards.map((b) => ({ id: b.id }));
}

export async function generateMetadata({ params }: PageProps<"/demo/boards/[id]">): Promise<Metadata> {
  const board = demoBoard((await params).id);
  if (!board) return { title: "Demo board" };
  const title = `${board.title} · Demo board`;
  const description = board.description ?? "A sample moodboard of public-domain museum pieces in Thread's read-only demo.";
  const first = board.blocks.find((b) => b.kind === "piece");
  const cover = first?.kind === "piece" ? demoPiece(first.piece) : undefined;
  const image = cover && { url: demoAsset(cover.image), alt: pieceAlt(cover) };
  return { title, description, ...shareMetadata({ title, description, path: `/demo/boards/${board.id}`, image }) };
}

export default async function DemoBoardPage({ params }: PageProps<"/demo/boards/[id]">) {
  const board = demoBoard((await params).id);
  if (!board) notFound();
  const pieces = board.blocks.filter((b) => b.kind === "piece").length;
  return (
    <div className={PAGE}>
      <Link href="/demo" className="mb-6 inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" /> Demo
      </Link>
      <PageHeader kicker={`Demo board · ${pieces} pieces`} title={board.title} description={board.description} />
      <div className="mt-8">
        <DemoBoardView board={board} />
      </div>
    </div>
  );
}
