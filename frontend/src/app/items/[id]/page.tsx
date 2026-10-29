import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthGate } from "@/features/auth/auth-gate";
import { ItemDetail } from "@/features/items/item-detail";

export const metadata: Metadata = { title: "Item" };

export default function ItemPage({ params }: PageProps<"/items/[id]">) {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-8">
      {/* Params are runtime data with Cache Components, so they are read inside Suspense. */}
      <Suspense fallback={<div className="h-[60vh] animate-pulse rounded-[2px] bg-ink/[0.06]" />}>
        {params.then(({ id }) => (
          <AuthGate what="this piece">
            <ItemDetail id={id} />
          </AuthGate>
        ))}
      </Suspense>
    </div>
  );
}
