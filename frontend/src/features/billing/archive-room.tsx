import Link from "next/link";

import { formatStorage } from "@/features/pricing/format";
import { ApiError } from "@/lib/api-client";
import type { ArchiveUsage } from "@/types/api";

/** The server refused a piece because the archive has no room under its plan. */
export function isArchiveFull(error: unknown): boolean {
  return error instanceof ApiError && error.code === "quota_exceeded";
}

/** Shown beside a refused upload: where to see the plan and how much room it gives. */
export function SeeYourPlan({ className }: { className?: string }) {
  return (
    <Link href="/account/billing" className={className ?? "text-xs underline underline-offset-2"}>
      See your plan
    </Link>
  );
}

/** How much of the archive's room is used, as the server counts it. */
export function ArchiveRoom({ usage, roomier }: { usage: ArchiveUsage; roomier: string | null }) {
  if (usage.max_pieces === null || usage.max_bytes === null) return null;
  return (
    <div className="mt-5">
      <dl className="grid max-w-sm grid-cols-2 gap-y-1 text-sm">
        <dt className="text-ink-muted">Pieces</dt>
        <dd className="text-right">
          {usage.pieces} of {usage.max_pieces}
        </dd>
        <dt className="text-ink-muted">Storage</dt>
        <dd className="text-right">
          {formatStorage(usage.bytes_used)} of {formatStorage(usage.max_bytes)}
        </dd>
      </dl>
      {usage.earlier_limits && (
        <p className="mt-2 text-sm text-ink-muted">Your account keeps the room it had before plans, which is more than this plan gives.</p>
      )}
      {usage.full && (
        <p className="mt-3 border-l-2 border-warning pl-3 text-sm">
          Your archive is full. Every piece you have is kept, and you can still view, edit and delete them. To add another, delete a
          piece{roomier ? `, or buy a period of ${roomier} below` : ""}.
        </p>
      )}
    </div>
  );
}
