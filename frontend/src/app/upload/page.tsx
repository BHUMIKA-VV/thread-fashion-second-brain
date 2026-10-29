import type { Metadata } from "next";

import { PAGE, PageHeader } from "@/components/page-header";
import { AuthGate } from "@/features/auth/auth-gate";
import { VerifiedOnly } from "@/features/auth/verified-only";
import { UploadPanel } from "@/features/upload/upload-panel";

export const metadata: Metadata = { title: "Upload" };

export default function UploadPage() {
  return (
    <div className={PAGE}>
      <PageHeader
        kicker="Add to your archive"
        title="Upload"
        description="Outfits, single garments, fabric swatches or accessories. Images are checked, kept private to your account and analysed by Thread."
      />
      <div className="mt-10 max-w-3xl">
        <AuthGate what="your archive">
          <VerifiedOnly>
            <UploadPanel />
          </VerifiedOnly>
        </AuthGate>
      </div>
    </div>
  );
}
