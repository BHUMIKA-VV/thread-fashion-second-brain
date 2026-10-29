import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" }; // the layout adds " · Thread"

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-8 sm:py-28">
      <p className="font-display text-8xl italic leading-none text-clay sm:text-9xl">404</p>
      <h1 className="mt-6 max-w-2xl font-display text-4xl tracking-tight sm:text-5xl">This page doesn&apos;t exist</h1>
      <p className="mt-2 text-sm text-ink-muted">The link may be mistyped, or the page was removed.</p>
      <div className="mt-10 flex flex-wrap gap-3">
        <ButtonLink href="/gallery">Enter the archive</ButtonLink>
        <ButtonLink href="/" variant="secondary">
          Home
        </ButtonLink>
      </div>
    </div>
  );
}
