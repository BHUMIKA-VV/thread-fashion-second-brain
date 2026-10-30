import type { Metadata } from "next";
import { Suspense } from "react";

import { ShowcaseCollectionView } from "@/features/showcase/showcase-collection";

export const metadata: Metadata = { title: "Showcase collection" };

export default function ShowcaseCollectionPage({ params }: PageProps<"/showcase/collections/[id]">) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-8 sm:py-16">
      <Suspense fallback={<div role="status" aria-label="Loading the collection" className="h-[50vh] animate-pulse bg-ink/[0.05]" />}>
        {params.then(({ id }) => (
          <ShowcaseCollectionView id={id} />
        ))}
      </Suspense>
    </div>
  );
}
