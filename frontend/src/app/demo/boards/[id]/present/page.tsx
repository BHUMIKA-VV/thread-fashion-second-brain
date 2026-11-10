import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DEMO, demoBoard } from "@/features/demo/demo-data";
import { DemoPresentation } from "@/features/demo/demo-presentation";

export function generateStaticParams() {
  return DEMO.boards.map((b) => ({ id: b.id }));
}

export async function generateMetadata({ params }: PageProps<"/demo/boards/[id]/present">): Promise<Metadata> {
  const board = demoBoard((await params).id);
  // The board page is the one to share and index; the slides repeat it.
  return { title: board ? `Presenting ${board.title} · Demo` : "Demo presentation", robots: { index: false } };
}

export default async function DemoPresentPage({ params }: PageProps<"/demo/boards/[id]/present">) {
  const board = demoBoard((await params).id);
  if (!board) notFound();
  return <DemoPresentation board={board} />;
}
