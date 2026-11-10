import type { Metadata } from "next";

import { PAGE, PageHeader } from "@/components/page-header";
import { DemoBoardList } from "@/features/demo/demo-board";
import { DemoBrowse } from "@/features/demo/demo-browse";
import { DEMO } from "@/features/demo/demo-data";
import { DemoNotice } from "@/features/demo/demo-notice";
import { DemoCollectionList, DemoOutfitList } from "@/features/demo/demo-sections";
import { shareMetadata } from "@/lib/site";

const DESCRIPTION = `A read-only demo of Thread: ${DEMO.pieces.length} public-domain garments and textiles with measured palettes, tags, kindred pieces, collections, outfits and a sample moodboard.`;

export const metadata: Metadata = {
  title: "Explore Thread",
  description: DESCRIPTION,
  ...shareMetadata({ title: "Explore Thread", description: DESCRIPTION, path: "/demo" }),
};

export default function DemoPage() {
  return (
    <div className={PAGE}>
      <PageHeader
        kicker="Read-only demo"
        title="Explore Thread"
        description="Search a small archive the way you would your own: by colour, craft or type. Open any piece to see what Thread measured."
      />
      <div className="mt-8 space-y-12">
        <DemoNotice />
        <DemoBrowse pieces={DEMO.pieces} families={DEMO.families.map((f) => f.family)} />

        <section aria-labelledby="demo-collections" className="border-t border-ink pt-5">
          <h2 id="demo-collections" className="font-display text-2xl">
            Collections
          </h2>
          <DemoCollectionList collections={DEMO.collections} />
        </section>

        <section aria-labelledby="demo-outfits" className="border-t border-ink pt-5">
          <h2 id="demo-outfits" className="font-display text-2xl">
            Outfits
          </h2>
          <p className="mt-1 text-sm text-ink-muted">Styled for this demo from pieces of different eras and makers.</p>
          <DemoOutfitList outfits={DEMO.outfits} />
        </section>

        {DEMO.boards.length > 0 && (
          <section aria-labelledby="demo-boards" className="border-t border-ink pt-5">
            <h2 id="demo-boards" className="font-display text-2xl">
              Boards
            </h2>
            <p className="mt-1 text-sm text-ink-muted">A moodboard made for this demo, with its colour story. Open it, or present it as slides.</p>
            <DemoBoardList boards={DEMO.boards} />
          </section>
        )}
      </div>
    </div>
  );
}
