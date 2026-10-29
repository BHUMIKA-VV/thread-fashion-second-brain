import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/** The editorial masthead every section opens with: kicker, serif title, hairline rule. */
export function PageHeader({
  kicker,
  title,
  description,
  action,
  className,
}: {
  kicker: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("border-b border-line pb-8", className)}>
      <p className="text-[11px] uppercase tracking-[0.28em] text-ink-muted">{kicker}</p>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-2xl">
          <h1 className="font-display text-5xl leading-none tracking-tight sm:text-6xl">{title}</h1>
          {description && <p className="mt-4 leading-relaxed text-ink-muted">{description}</p>}
        </div>
        {action}
      </div>
    </header>
  );
}

/** Page frame aligned with the header and footer. */
export const PAGE = "mx-auto w-full max-w-7xl px-4 py-12 sm:px-8 sm:py-16";
