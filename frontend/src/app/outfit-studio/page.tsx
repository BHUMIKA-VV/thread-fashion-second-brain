import type { Metadata } from "next";

import { PAGE, PageHeader } from "@/components/page-header";
import { AuthGate } from "@/features/auth/auth-gate";
import { OutfitList } from "@/features/outfit-studio/outfit-list";

export const metadata: Metadata = { title: "Outfit Studio" };

export default function OutfitStudioPage() {
  return (
    <div className={PAGE}>
      <PageHeader
        kicker="Compositions"
        title="Outfit Studio"
        description="Compose pieces from your archive into outfits, and see how their measured colours relate. Private to your account."
      />
      <div className="mt-10">
        <AuthGate what="your outfits">
          <OutfitList />
        </AuthGate>
      </div>
    </div>
  );
}
