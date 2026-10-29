"use client";

import type { ReactNode } from "react";

import { ResendVerification } from "./account-settings";
import { useSession } from "./use-session";

/** Uploading needs a confirmed email; until then, say so and offer the link again. */
export function VerifiedOnly({ children }: { children: ReactNode }) {
  const me = useSession().data;
  if (me && !me.email_verified) {
    return (
      <div className="border-y border-line py-10">
        <p className="font-display text-2xl">Confirm your email to add pieces</p>
        <p className="mt-2 text-sm text-ink-muted">
          We sent a link to <strong className="font-medium text-ink">{me.email}</strong> when you signed up.
        </p>
        <ResendVerification />
      </div>
    );
  }
  return <>{children}</>;
}
