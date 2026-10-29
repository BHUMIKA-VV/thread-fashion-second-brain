import type { Metadata } from "next";
import { Suspense } from "react";

import { PAGE, PageHeader } from "@/components/page-header";
import { ButtonLink } from "@/components/ui/button";
import { AuthGate } from "@/features/auth/auth-gate";
import { Gallery } from "@/features/gallery/gallery";

export const metadata: Metadata = { title: "Archive" };

export default function GalleryPage() {
  return (
    <div className={PAGE}>
      <PageHeader
        kicker="Your archive"
        title="Archive"
        description="Every piece you have kept, searchable by tag, colour and craft."
        action={<ButtonLink href="/upload">Add a piece</ButtonLink>}
      />
      <div className="mt-8">
        {/* The gallery reads its filters from the URL (useSearchParams), so Next requires a
            Suspense boundary for the prerendered page shell. */}
        <Suspense fallback={<div role="status" className="h-64 animate-pulse bg-ink/[0.05]" aria-label="Loading gallery" />}>
          <AuthGate>
            <Gallery />
          </AuthGate>
        </Suspense>
      </div>
    </div>
  );
}
