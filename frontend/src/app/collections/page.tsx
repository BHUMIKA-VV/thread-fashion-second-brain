import type { Metadata } from "next";

import { CollectionsList } from "@/features/collections/collections-list";

export const metadata: Metadata = { title: "Collections" };

export default function CollectionsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8">
      <p className="text-xs uppercase tracking-[0.3em] text-ink-muted">Mood boards</p>
      <h1 className="mt-3 font-display text-4xl tracking-tight">Collections</h1>
      <p className="mt-3 max-w-xl text-ink-muted">
        Group pieces into private boards. Deleting a collection never deletes the pieces in it.
      </p>
      <div className="mt-10">
        <CollectionsList />
      </div>
    </div>
  );
}
