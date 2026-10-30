import type { Metadata } from "next";
import { Suspense } from "react";

import { PAGE, PageHeader } from "@/components/page-header";
import { ShowcaseGrid } from "@/features/showcase/showcase-grid";

export const metadata: Metadata = { title: "Showcase" };

export default function ShowcasePage() {
  return (
    <div className={PAGE}>
      <PageHeader kicker="Public archive" title="Showcase" />
      <div className="mt-8">
        {/* Filters live in the URL (useSearchParams), so the grid needs a Suspense boundary. */}
        <Suspense fallback={<div role="status" aria-label="Loading the showcase" className="h-96 animate-pulse bg-ink/[0.05]" />}>
          <ShowcaseGrid />
        </Suspense>
      </div>
    </div>
  );
}
