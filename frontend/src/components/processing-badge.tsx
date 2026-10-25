import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { ProcessingStatus } from "@/types/api";

const LABELS: Record<ProcessingStatus, { label: string; tone: StatusTone }> = {
  queued: { label: "Awaiting analysis", tone: "idle" },
  processing: { label: "Analysing", tone: "neutral" },
  completed: { label: "Analysed", tone: "success" },
  // e.g. palette done but the image model is not installed
  partially_completed: { label: "Partly analysed", tone: "warning" },
  failed: { label: "Analysis failed", tone: "danger" },
};

export function ProcessingBadge({ status }: { status: ProcessingStatus }) {
  const { label, tone } = LABELS[status];
  return <StatusBadge tone={tone} label={label} />;
}
