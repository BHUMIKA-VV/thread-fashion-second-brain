import type { Metadata } from "next";
import { Suspense } from "react";

import { ShowcasePiece } from "@/features/showcase/showcase-piece";

export const metadata: Metadata = { title: "Showcase piece" };

export default function ShowcasePiecePage({ params }: PageProps<"/showcase/[id]">) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-8 sm:py-16">
      <Suspense fallback={<div role="status" aria-label="Loading the piece" className="h-[60vh] animate-pulse bg-ink/[0.05]" />}>
        {params.then(({ id }) => (
          <ShowcasePiece id={id} />
        ))}
      </Suspense>
    </div>
  );
}
