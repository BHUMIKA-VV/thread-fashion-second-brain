import type { Metadata } from "next";

import { PAGE, PageHeader } from "@/components/page-header";
import { AuthGate } from "@/features/auth/auth-gate";
import { BillingPage } from "@/features/billing/billing-page";

export const metadata: Metadata = { title: "Plan and payments" };

// Razorpay Checkout runs here, under this page's own CSP (see next.config.ts).
export default function AccountBillingPage() {
  return (
    <div className={PAGE}>
      <PageHeader kicker="Settings" title="Plan and payments" />
      <div className="mt-10 max-w-3xl">
        <AuthGate what="your plan">
          <BillingPage />
        </AuthGate>
      </div>
    </div>
  );
}
