import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthGate } from "@/features/auth/auth-gate";
import { OutfitEditor } from "@/features/outfit-studio/outfit-editor";

export const metadata: Metadata = { title: "Outfit" };

export default function OutfitPage({ params }: PageProps<"/outfit-studio/[id]">) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-8 sm:py-12">
      {/* Params are runtime data with Cache Components, so they are read inside Suspense. */}
      <Suspense fallback={<div className="h-[60vh] animate-pulse bg-ink/[0.05]" />}>
        {params.then(({ id }) => (
          <AuthGate what="this outfit">
            <OutfitEditor id={id} />
          </AuthGate>
        ))}
      </Suspense>
    </div>
  );
}
