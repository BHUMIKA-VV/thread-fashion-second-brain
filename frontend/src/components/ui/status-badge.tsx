import { cn } from "@/lib/cn";

/** "neutral" pulses (work in progress); "idle" is static (waiting, nothing running). */
export type StatusTone = "success" | "warning" | "danger" | "neutral" | "idle";

// Quiet by design: a dot and coloured text, no pill, so status never competes with images.
const tones: Record<StatusTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  neutral: "text-ink-muted",
  idle: "text-ink-muted",
};

const dots: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-ink-muted animate-pulse",
  idle: "bg-ink-muted/60",
};

export function StatusBadge({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        tones[tone],
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", dots[tone])} />
      {label}
    </span>
  );
}
