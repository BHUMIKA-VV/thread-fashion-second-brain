import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" }; // the layout adds " · Thread"

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-line bg-paper-raised p-10 text-center">
      <p className="text-xs uppercase tracking-[0.3em] text-ink-muted">404</p>
      <h1 className="mt-2 font-display text-3xl tracking-tight">This page doesn&apos;t exist</h1>
      <p className="mt-2 text-sm text-ink-muted">The link may be mistyped, or the page was removed.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <ButtonLink href="/gallery">Go to the gallery</ButtonLink>
        <ButtonLink href="/dashboard" variant="secondary">
          Dashboard
        </ButtonLink>
      </div>
    </div>
  );
}
