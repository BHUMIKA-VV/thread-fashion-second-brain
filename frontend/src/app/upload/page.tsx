import type { Metadata } from "next";

import { PAGE, PageHeader } from "@/components/page-header";
import { UploadPanel } from "@/features/upload/upload-panel";

export const metadata: Metadata = { title: "Upload" };

export default function UploadPage() {
  return (
    <div className={PAGE}>
      <PageHeader
        kicker="Add to your archive"
        title="Upload"
        description="Outfits, single garments, fabric swatches or accessories. Images are checked, stored privately and analysed on this computer."
      />
      <div className="mt-10 max-w-3xl">
        <UploadPanel />
      </div>
    </div>
  );
}
