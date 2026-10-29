import type { Metadata } from "next";
import { Suspense } from "react";

import { ResetPasswordForm } from "@/features/auth/email-links";
import { AuthShell } from "@/features/auth/form-parts";

export const metadata: Metadata = { title: "Choose a new password", referrer: "no-referrer" };

export default function ResetPasswordPage() {
  return (
    <AuthShell kicker="Account" title="Choose a new password" aside="Choosing a new password signs you out on every device.">
      <Suspense fallback={<div role="status" aria-label="Loading" className="h-72 animate-pulse bg-ink/[0.05]" />}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
