import { ArrowRight } from "lucide-react";

import { ButtonLink } from "@/components/ui/button";
import { DEMO } from "@/features/demo/demo-data";
import { DemoCollectionList } from "@/features/demo/demo-sections";

/** The demo's sample collections on the landing page. A server component: app/page.tsx renders
 * it and hands it to the (client) hero, so the demo dataset stays out of the browser bundle. */
export function DemoInvite() {
  return (
    <section aria-labelledby="demo-invite-title" className="border-y border-line bg-paper-raised py-16">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="text-[11px] uppercase tracking-[0.3em] text-ink-muted">Read-only demo</p>
            <h2 id="demo-invite-title" className="mt-4 font-display text-4xl leading-tight tracking-tight">
              Try it on twenty museum pieces
            </h2>
            <p className="mt-3 leading-relaxed text-ink-muted">
              Public-domain garments and Indian textiles from The Met and the Cleveland Museum of Art, with the
              palettes, tags, kindred pieces and outfits Thread computed for them. Nothing you do there is saved.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/demo">
              Explore the demo <ArrowRight aria-hidden className="size-4" />
            </ButtonLink>
            <ButtonLink href="/try" variant="secondary">
              Try your own photo
            </ButtonLink>
          </div>
        </div>
        <DemoCollectionList collections={DEMO.collections} />
      </div>
    </section>
  );
}
