import type { Metadata } from "next";

import { ForgotPasswordForm } from "@/features/auth/email-links";
import { AuthShell } from "@/features/auth/form-parts";

export const metadata: Metadata = { title: "Forgot your password" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell kicker="It happens" title="Forgot your password?" aside="Enter your email and we'll send a link to choose a new one.">
      <ForgotPasswordForm />
    </AuthShell>
  );
}
