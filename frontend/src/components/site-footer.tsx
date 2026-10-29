import Link from "next/link";

import { Logo } from "@/components/brand/logo";

const LINKS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/settings", label: "System" },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 sm:grid-cols-12 sm:px-8">
        <div className="sm:col-span-5">
          <Logo height={30} tone="mono" label="Thread" />
          <p className="mt-3 font-display text-lg italic text-ink">Everything you wear leaves a trace.</p>
        </div>
        <p className="text-sm leading-relaxed text-ink-muted sm:col-span-4">
          A personal fashion archive. Your images and analysis stay on this computer unless you
          choose to send a piece for deep analysis.
        </p>
        <nav aria-label="More" className="sm:col-span-3 sm:justify-self-end">
          <ul className="flex gap-6 text-sm">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-ink-muted underline-offset-4 hover:text-ink hover:underline">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
