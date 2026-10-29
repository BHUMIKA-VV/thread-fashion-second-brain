import type { Metadata } from "next";

import { PAGE, PageHeader } from "@/components/page-header";
import { AccountSettings } from "@/features/auth/account-settings";
import { AuthGate } from "@/features/auth/auth-gate";

export const metadata: Metadata = { title: "Your account" };

export default function AccountPage() {
  return (
    <div className={PAGE}>
      <PageHeader kicker="Settings" title="Your account" />
      <div className="mt-10 max-w-3xl">
        <AuthGate what="your account">
          <AccountSettings />
        </AuthGate>
      </div>
    </div>
  );
}
