import Image from "next/image";

import { cn } from "@/lib/cn";

/**
 * Thread's official marks, taken from the brand board (scripts/extract_brand.py). Every page
 * uses this component, never a re-drawn copy.
 *
 * - "wordmark": THREAD with the thread running through it. Legible down to ~26px tall; sharp up
 *   to ~160px (the source is a raster crop; above that it softens slightly).
 * - "icon": the bow-knot app icon on its ink tile, for small spaces.
 *
 * Tones (wordmark): "ink" (ink letters, indigo thread; light grounds), "light" (ivory and sand;
 * dark grounds), "mono" / "mono-light" (one colour).
 */
type Tone = "ink" | "light" | "mono" | "mono-light";

const WORDMARK_ASPECT = 1386 / 483;
const WORDMARK_FILES: Record<Tone, string> = {
  ink: "/brand/thread-wordmark.png",
  light: "/brand/thread-wordmark-light.png",
  mono: "/brand/thread-wordmark-mono.png",
  "mono-light": "/brand/thread-wordmark-mono-light.png",
};

type Props = {
  variant?: "wordmark" | "icon";
  tone?: Tone;
  /** Rendered height in px (for "fluid", the largest height it will be shown at). */
  height: number;
  className?: string;
  /** Accessible name; pass "" when the mark sits next to visible text that names it. */
  label?: string;
  /** Wordmark only: fill the container's width, keeping proportions. */
  fluid?: boolean;
  /** Load eagerly (use for the mark above the fold, e.g. in the header). */
  priority?: boolean;
};

export function Logo({
  variant = "wordmark",
  tone = "ink",
  height,
  className,
  label = "Thread",
  fluid = false,
  priority = false,
}: Props) {
  if (variant === "icon") {
    return (
      <Image
        src="/brand/thread-app-icon.png"
        alt={label}
        width={height}
        height={height}
        priority={priority}
        className={cn("shrink-0", className)}
      />
    );
  }
  const width = Math.round(height * WORDMARK_ASPECT);
  return (
    <Image
      src={WORDMARK_FILES[tone]}
      alt={label}
      width={width}
      height={height}
      priority={priority}
      sizes={fluid ? "(max-width: 640px) 100vw, 640px" : `${width}px`}
      className={cn(fluid ? "block h-auto w-full" : "shrink-0", className)}
    />
  );
}
