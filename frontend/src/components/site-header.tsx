"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { cn } from "@/lib/cn";

// Only routes that exist are listed; more are added as milestones land.
const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/gallery", label: "Gallery" },
  { href: "/upload", label: "Upload" },
  { href: "/collections", label: "Collections" },
  { href: "/settings", label: "System" },
] as const;

function isActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href === "/gallery") return pathname === "/gallery" || pathname.startsWith("/items/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  return (
    <header className="border-b border-line/80 bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4 sm:px-8">
        <Link href="/" className="font-display text-2xl tracking-tight">
          Thread
        </Link>
        <nav aria-label="Main">
          {/* The pathname is runtime data on dynamic routes, so the active state streams in;
              the fallback renders the same links without highlighting. */}
          <Suspense fallback={<NavLinks pathname={null} />}>
            <ActiveNavLinks />
          </Suspense>
        </nav>
      </div>
    </header>
  );
}

function ActiveNavLinks() {
  return <NavLinks pathname={usePathname()} />;
}

function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <ul className="flex flex-wrap items-center gap-0.5 sm:gap-1">
      {NAV.map((item) => {
        const active = isActive(item.href, pathname);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-full px-2.5 py-1.5 text-xs transition-colors sm:px-4 sm:py-2 sm:text-sm",
                active ? "bg-ink text-paper" : "text-ink-muted hover:text-ink",
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
