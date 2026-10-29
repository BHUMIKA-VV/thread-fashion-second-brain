import type { Metadata } from "next";
import { Suspense } from "react";

import { CollectionDetailView } from "@/features/collections/collection-detail";

export const metadata: Metadata = { title: "Collection" };

export default function CollectionPage({ params }: PageProps<"/collections/[id]">) {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-8">
      {/* Params are runtime data with Cache Components, so they are read inside Suspense. */}
      <Suspense fallback={<div className="h-[50vh] animate-pulse rounded-2xl bg-ink/[0.06]" />}>
        {params.then(({ id }) => (
          <CollectionDetailView id={id} />
        ))}
      </Suspense>
    </div>
  );
}
