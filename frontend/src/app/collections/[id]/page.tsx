import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthGate } from "@/features/auth/auth-gate";
import { CollectionDetailView } from "@/features/collections/collection-detail";

export const metadata: Metadata = { title: "Collection" };

export default function CollectionPage({ params }: PageProps<"/collections/[id]">) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-8 sm:py-16">
      {/* Params are runtime data with Cache Components, so they are read inside Suspense. */}
      <Suspense fallback={<div className="h-[50vh] animate-pulse bg-ink/[0.05]" />}>
        {params.then(({ id }) => (
          <AuthGate what="this collection">
            <CollectionDetailView id={id} />
          </AuthGate>
        ))}
      </Suspense>
    </div>
  );
}
