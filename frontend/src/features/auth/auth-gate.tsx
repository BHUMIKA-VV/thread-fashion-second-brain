"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Button, ButtonLink } from "@/components/ui/button";

import { useSession } from "./use-session";

/**
 * Shows its children only to a signed-in visitor; everyone else gets a way in. The API
 * refuses signed-out requests anyway, so this is about a clear page, not about security.
 */
export function AuthGate({ children, what = "your archive" }: { children: ReactNode; what?: string }) {
  const session = useSession();
  const pathname = usePathname();

  if (session.isPending) {
    return <div role="status" aria-label="Checking your session" className="h-64 animate-pulse bg-ink/[0.05]" />;
  }
  if (session.isError) {
    return (
      <div role="alert" className="border-y border-danger/30 py-12 text-center">
        <p className="font-display text-xl">Thread could not check whether you are signed in.</p>
        <p className="mt-2 text-sm text-ink-muted">{session.error.message}</p>
        <Button className="mt-6" variant="secondary" onClick={() => void session.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  if (session.data === null) {
    const next = pathname ? `?next=${encodeURIComponent(pathname)}` : "";
    return (
      <div className="border-y border-line py-20 text-center">
        <p className="font-display text-3xl">Sign in to see {what}</p>
        <p className="mx-auto mt-3 max-w-sm text-sm text-ink-muted">
          Every archive on Thread is private to its account.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <ButtonLink href={`/login${next}`}>Sign in</ButtonLink>
          <ButtonLink href="/signup" variant="secondary">
            Create an account
          </ButtonLink>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
