import type { Metadata } from "next";

import { PAGE, PageHeader } from "@/components/page-header";
import { ColourLab } from "@/features/colour-lab/colour-lab";

export const metadata: Metadata = { title: "Colour Lab" };

export default function ColourLabPage() {
  return (
    <div className={PAGE}>
      <PageHeader
        kicker="Colour Lab"
        title="Colour Lab"
        description="Every colour Thread has measured in your archive, by family and piece by piece."
      />
      <ColourLab />
    </div>
  );
}
