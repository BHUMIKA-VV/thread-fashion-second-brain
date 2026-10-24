import type { Metadata } from "next";

import { UploadPanel } from "@/features/upload/upload-panel";

export const metadata: Metadata = { title: "Upload" };

export default function UploadPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8">
      <p className="text-xs uppercase tracking-[0.3em] text-ink-muted">Add to your library</p>
      <h1 className="mt-3 font-display text-4xl tracking-tight">Upload</h1>
      <p className="mt-3 max-w-xl text-ink-muted">
        Outfits, single garments, fabric swatches or accessories. Images are checked, stored
        privately and queued for analysis.
      </p>
      <div className="mt-10">
        <UploadPanel />
      </div>
    </div>
  );
}
