"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";

import { Button, ButtonLink } from "@/components/ui/button";

/** Shown when a page fails to render. Data errors are handled inside each screen; this is the
 * last resort, so it offers a retry and a way out instead of a blank page. */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto max-w-xl rounded-2xl border border-line bg-paper-raised p-10 text-center">
      <h1 className="font-display text-3xl tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-muted">
        This page could not be shown. Your library is unaffected. Try again, or check the System page.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button onClick={() => retry()}>Try again</Button>
        <ButtonLink href="/settings" variant="secondary">
          System status
        </ButtonLink>
      </div>
    </div>
  );
}
