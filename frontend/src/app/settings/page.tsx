import type { Metadata } from "next";

import { PAGE, PageHeader } from "@/components/page-header";
import { SystemStatus } from "@/features/health/system-status";

export const metadata: Metadata = { title: "System" };

export default function SettingsPage() {
  return (
    <div className={PAGE}>
      <PageHeader
        kicker="Development"
        title="System"
        description={
          <>
            Live health of the local services Thread depends on. The browser reaches the API
            through the Next.js <code className="font-mono text-sm">/api</code> proxy.
          </>
        }
      />
      <div className="mt-10 max-w-3xl">
        <SystemStatus />
      </div>
    </div>
  );
}
