import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { Gallery } from "@/features/gallery/gallery";

export const metadata: Metadata = { title: "Gallery" };

export default function GalleryPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-ink-muted">Your library</p>
          <h1 className="mt-3 font-display text-4xl tracking-tight">Gallery</h1>
        </div>
        <ButtonLink href="/upload">Upload</ButtonLink>
      </div>
      <div className="mt-10">
        <Gallery />
      </div>
    </div>
  );
}
