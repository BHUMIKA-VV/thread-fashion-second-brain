"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense } from "react";

import { Logo } from "@/components/brand/logo";
import { useResetForAccount, useSession } from "@/features/auth/use-session";
import { cn } from "@/lib/cn";
import { signOut } from "@/services/auth";

// The main sections. Overview and System are in the footer, to keep this compact. Signed
// out, there is no archive to show, so the header offers the public showcase instead.
export const PUBLIC_NAV = [{ href: "/showcase", label: "Showcase" }] as const;

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
        <div className="flex flex-wrap items-center gap-x-8 gap-y-1">
          <nav aria-label="Main">
            {/* The pathname is runtime data on dynamic routes, so the active state streams in;
                the fallback renders the same links without highlighting. */}
            <Suspense fallback={<NavLinks pathname={null} />}>
              <ActiveNavLinks />
            </Suspense>
          </nav>
          <AccountLinks />
        </div>
      </div>
    </header>
  );
}

function ActiveNavLinks() {
  return <NavLinks pathname={usePathname()} />;
}

function NavLinks({ pathname }: { pathname: string | null }) {
  const signedOut = useSession().data === null;
  const links = signedOut ? PUBLIC_NAV : NAV;
  return (
    <ul className="flex items-center gap-5 sm:gap-8">
      {links.map((item) => {
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

const quiet = "text-[13px] tracking-[0.06em] text-ink-muted transition-colors hover:text-ink sm:text-sm";

/** Who is signed in, and the way in or out. */
function AccountLinks() {
  const session = useSession();
  const router = useRouter();
  const resetForAccount = useResetForAccount();
  const out = useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      resetForAccount(null);
      router.push("/");
    },
  });

  // Same width while loading, so the header doesn't jump.
  if (session.isPending) return <span aria-hidden className="inline-block h-5 w-28" />;
  if (!session.data) {
    return (
      <div className="flex items-center gap-4 border-l border-line pl-6">
        <Link href="/login" className={quiet}>
          Sign in
        </Link>
        <Link
          href="/signup"
          className="rounded-[2px] bg-ink px-3 py-1.5 text-[13px] tracking-[0.04em] text-paper-raised transition-colors hover:bg-indigo"
        >
          Create account
        </Link>
      </div>
    );
  }
  const firstName = session.data.display_name.split(/\s+/)[0] || "Account";
  return (
    <div className="flex items-center gap-4 border-l border-line pl-6">
      <Link href="/account" className={cn(quiet, "max-w-32 truncate")}>
        <span className="sr-only">Your account: </span>
        {firstName}
      </Link>
      <button type="button" onClick={() => out.mutate()} disabled={out.isPending} className={quiet}>
        {out.isPending ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
