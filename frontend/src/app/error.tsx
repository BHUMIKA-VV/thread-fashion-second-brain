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
    <div role="alert" className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-8 sm:py-28">
      <h1 className="max-w-2xl font-display text-4xl tracking-tight sm:text-5xl">Something went wrong</h1>
      <p className="mt-4 max-w-xl text-ink-muted">
        This page could not be shown. Your library is unaffected. Try again, or check the System page.
      </p>
      <div className="mt-10 flex flex-wrap gap-3">
        <Button onClick={() => retry()}>Try again</Button>
        <ButtonLink href="/settings" variant="secondary">
          System status
        </ButtonLink>
      </div>
    </div>
  );
}
