import type { Metadata } from "next";

import { CountView } from "@/components/count-view";
import { AuthShell } from "@/features/auth/form-parts";
import { SignUpForm } from "@/features/auth/sign-up-form";

export const metadata: Metadata = { title: "Create an account" };

export default function SignUpPage() {
  return (
    <AuthShell
      kicker="Begin an archive"
      title="Create an account"
      aside="Keep the garments, fabrics and details you love. Thread measures each palette, suggests the craft and finds kindred pieces. Your archive is private to you."
    >
      <CountView event="signup_view" />
      <SignUpForm />
    </AuthShell>
  );
}
