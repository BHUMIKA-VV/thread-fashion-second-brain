import type { Metadata } from "next";

import { PAGE, PageHeader } from "@/components/page-header";
import { AccountsAdmin } from "@/features/auth/accounts-admin";
import { AuthGate } from "@/features/auth/auth-gate";

export const metadata: Metadata = { title: "Accounts" };

export default function AccountsPage() {
  return (
    <div className={PAGE}>
      <PageHeader
        kicker="Owner"
        title="Accounts"
        description="Everyone with an archive on this Thread. Disabling an account signs it out and stops it signing in; its data is kept."
      />
      <div className="mt-10 max-w-4xl">
        <AuthGate what="accounts">
          <AccountsAdmin />
        </AuthGate>
      </div>
    </div>
  );
}
