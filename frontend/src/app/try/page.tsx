import type { Metadata } from "next";

import { CountView } from "@/components/count-view";
import { PAGE, PageHeader } from "@/components/page-header";
import { Playground } from "@/features/playground/playground";
import { shareMetadata } from "@/lib/site";

const DESCRIPTION =
  "Find the colour palette of a garment, outfit or fabric from one photo, with no account: measured colours with names and shares, suggested tags, and the closest museum pieces in Thread's demo.";

export const metadata: Metadata = {
  title: "Colour palette from a photo",
  description: DESCRIPTION,
  ...shareMetadata({ title: "Try Thread on your photo", description: DESCRIPTION, path: "/try" }),
};

export default function TryPage() {
  return (
    <div className={PAGE}>
      <CountView event="playground_view" />
      <PageHeader
        kicker="Playground"
        title="Try Thread on your photo"
        description="One photo of a garment, an outfit or a fabric. Thread measures its colours, suggests tags and finds the museum pieces in the demo that look and colour most alike."
      />
      <div className="mt-10">
        <Playground />
      </div>
    </div>
  );
}
