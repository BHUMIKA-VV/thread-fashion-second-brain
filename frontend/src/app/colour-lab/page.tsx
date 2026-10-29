import type { Metadata } from "next";

import { PAGE, PageHeader } from "@/components/page-header";
import { AuthGate } from "@/features/auth/auth-gate";
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
      <div className="mt-10">
        <AuthGate what="your colours">
          <ColourLab />
        </AuthGate>
      </div>
    </div>
  );
}
