import Link from "next/link";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";

// Editorial, near-square controls: ink on ivory, a hairline border for the quieter action.
const base =
  "inline-flex items-center justify-center gap-2 rounded-[2px] px-5 py-2.5 text-sm font-medium tracking-[0.02em] transition-colors disabled:pointer-events-none disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-paper-raised hover:bg-indigo",
  secondary: "border border-ink/25 bg-transparent text-ink hover:border-ink",
  ghost: "text-ink hover:bg-ink/5",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={cn(base, variants[variant], className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cn(base, variants[variant], className)} {...props} />;
}
