"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/cn";

// The main sections. Overview and System are in the footer, to keep this compact.
export const NAV = [
  { href: "/gallery", label: "Archive" },
  { href: "/colour-lab", label: "Colour Lab" },
  { href: "/collections", label: "Collections" },
  { href: "/upload", label: "Upload" },
] as const;

export function isActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href === "/gallery") return pathname === "/gallery" || pathname.startsWith("/items/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-paper">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3 sm:px-8 sm:py-4">
        <Link href="/" aria-label="Thread, home" className="-ml-1 rounded-[2px] p-1">
          <Logo height={42} label="" priority className="hidden sm:block" />
          <Logo height={32} label="" priority className="sm:hidden" />
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
    <ul className="flex items-center gap-5 sm:gap-8">
      {NAV.map((item) => {
        const active = isActive(item.href, pathname);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-block border-b py-1 text-[13px] tracking-[0.06em] transition-colors sm:text-sm",
                active ? "border-ink text-ink" : "border-transparent text-ink-muted hover:text-ink",
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
