import type { Metadata } from "next";
import { Suspense } from "react";

import { VerifyEmail } from "@/features/auth/email-links";
import { AuthShell } from "@/features/auth/form-parts";

export const metadata: Metadata = { title: "Confirm your email", referrer: "no-referrer" };

export default function VerifyEmailPage() {
  return (
    <AuthShell kicker="One last step" title="Confirm your email">
      <Suspense fallback={<div role="status" aria-label="Loading" className="h-40 animate-pulse bg-ink/[0.05]" />}>
        <VerifyEmail />
      </Suspense>
    </AuthShell>
  );
}
