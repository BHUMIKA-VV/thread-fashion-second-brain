import type { Metadata } from "next";

import { PAGE, PageHeader } from "@/components/page-header";
import { Dashboard } from "@/features/dashboard/dashboard";

export const metadata: Metadata = { title: "Overview" };

export default function DashboardPage() {
  return (
    <div className={PAGE}>
      <PageHeader
        kicker="Your archive at a glance"
        title="Overview"
        description="Real counts from your archive; each one opens the matching pieces."
      />
      <div className="mt-10">
        <Dashboard />
      </div>
    </div>
  );
}
