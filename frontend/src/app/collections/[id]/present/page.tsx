import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthGate } from "@/features/auth/auth-gate";
import { CollectionPresentation } from "@/features/present/presentations";

export const metadata: Metadata = { title: "Presenting a collection" };

export default function PresentCollectionPage({ params }: PageProps<"/collections/[id]/present">) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-8 sm:py-16">
      {/* Params are runtime data with Cache Components, so they are read inside Suspense. */}
      <Suspense fallback={<div className="h-[50vh] animate-pulse bg-ink/[0.05]" />}>
        {params.then(({ id }) => (
          <AuthGate what="this collection">
            <CollectionPresentation id={id} />
          </AuthGate>
        ))}
      </Suspense>
    </div>
  );
}
