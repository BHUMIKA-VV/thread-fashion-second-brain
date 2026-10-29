import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthShell } from "@/features/auth/form-parts";
import { SignInForm } from "@/features/auth/sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <AuthShell kicker="Welcome back" title="Sign in" aside="Your archive, palettes and collections are where you left them.">
      {/* The form reads ?next= (useSearchParams), which needs a Suspense boundary. */}
      <Suspense fallback={<div role="status" aria-label="Loading" className="h-72 animate-pulse bg-ink/[0.05]" />}>
        <SignInForm />
      </Suspense>
    </AuthShell>
  );
}
