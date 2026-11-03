"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FormError } from "@/features/auth/form-parts";
import { useSession } from "@/features/auth/use-session";
import { ApiError } from "@/lib/api-client";
import { deleteInterest, listInterest, ROLE_LABELS, setInterestContacted } from "@/services/interest";
import type { InterestRead, InterestRole, InterestSummary } from "@/types/api";

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });
const KEY = ["admin", "interest"];

/**
 * The owner's view of interest from the public site: wardrobe early access and the studio
 * pilot counted apart, beside the accounts that already exist, then every registration with a
 * way to mark it contacted or delete it (on request, or once dealt with).
 */
export function InterestAdmin() {
  const me = useSession().data;
  const queryClient = useQueryClient();
  const summary = useQuery({ queryKey: KEY, queryFn: listInterest, enabled: !!me?.is_owner });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: KEY });
  const contacted = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) => setInterestContacted(id, value),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: deleteInterest, onSuccess: refresh });

  if (!me?.is_owner) return null;
  return (
    <section aria-labelledby="interest-title" className="mt-16">
      <h2 id="interest-title" className="font-display text-3xl tracking-tight">
        Interest
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        People who asked to hear when sign-up opens, or to join the studio pilot. Only you see this. Delete a
        registration when someone asks; registrations are deleted automatically a year after their last update.
      </p>
      <div className="mt-6">
        {summary.isPending ? (
          <div role="status" aria-label="Loading interest" className="h-48 animate-pulse bg-ink/[0.05]" />
        ) : summary.isError ? (
          <div role="alert" className="border-y border-danger/30 py-10 text-center">
            <p className="font-display text-xl">Interest could not be loaded.</p>
            <Button className="mt-6" variant="secondary" onClick={() => void summary.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <InterestList
            summary={summary.data}
            busy={contacted.isPending || remove.isPending}
            error={contacted.error ?? remove.error}
            onContacted={(id, value) => contacted.mutate({ id, value })}
            onDelete={(id) => remove.mutate(id)}
          />
        )}
      </div>
    </section>
  );
}

function InterestList({
  summary: s,
  busy,
  error,
  onContacted,
  onDelete,
}: {
  summary: InterestSummary;
  busy: boolean;
  error: Error | null;
  onContacted: (id: string, value: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const roles = Object.entries(s.studio_by_role) as [InterestRole, number][];
  return (
    <div>
      <dl className="grid gap-px border-y border-ink bg-line sm:grid-cols-3">
        <Stat label="Wardrobe accounts" value={s.accounts} note={`${s.verified_accounts} confirmed`} />
        <Stat label="Wardrobe early access" value={s.wardrobe} note="waiting for sign-up" />
        <Stat
          label="Studio pilot"
          value={s.studio}
          note={roles.length ? roles.map(([role, n]) => `${n} ${ROLE_LABELS[role].toLowerCase()}`).join(" · ") : "none yet"}
        />
      </dl>
      <FormError>{error && (error instanceof ApiError ? error.message : "That didn't work.")}</FormError>
      {s.interest.length === 0 ? (
        <p className="border-b border-line py-10 text-center text-ink-muted">
          No one has registered yet. The form is on the studio pilot page.
        </p>
      ) : (
        <ul aria-label="Registrations" className="mt-6 border-t border-ink">
          {s.interest.map((row) => (
            <Registration
              key={row.id}
              row={row}
              busy={busy}
              onContacted={(value) => onContacted(row.id, value)}
              onDelete={() => onDelete(row.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="bg-paper px-4 py-5">
      <dt className="text-xs uppercase tracking-[0.2em] text-ink-muted">{label}</dt>
      <dd className="mt-2 font-display text-4xl">{value}</dd>
      <dd className="mt-1 text-xs text-ink-muted">{note}</dd>
    </div>
  );
}

function Registration({
  row,
  busy,
  onContacted,
  onDelete,
}: {
  row: InterestRead;
  busy: boolean;
  onContacted: (value: boolean) => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const who = row.name ? `${row.name} (${row.email})` : row.email;
  return (
    <li className="flex flex-wrap items-start justify-between gap-4 border-b border-line py-4">
      <div className="min-w-0 max-w-2xl">
        <p className="text-xs uppercase tracking-[0.2em] text-ink-muted">
          {row.kind === "studio" ? `Studio · ${row.role ? ROLE_LABELS[row.role] : ""}` : "Wardrobe"}
        </p>
        <p className="mt-1 font-display text-lg">{row.name ?? "No name given"}</p>
        <a href={`mailto:${row.email}`} className="break-all text-sm text-ink underline underline-offset-4">
          {row.email}
        </a>
        {row.message && <p className="mt-2 whitespace-pre-line text-sm text-ink-muted">{row.message}</p>}
        <p className="mt-1 text-xs text-ink-muted">
          {dateFormat.format(new Date(row.updated_at))}
          {row.contacted_at && ` · contacted ${dateFormat.format(new Date(row.contacted_at))}`}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => onContacted(!row.contacted_at)} aria-label={`${row.contacted_at ? "Unmark" : "Mark"} ${who} as contacted`}>
          {row.contacted_at ? "Not contacted" : "Contacted"}
        </Button>
        {confirming ? (
          <>
            <Button variant="secondary" disabled={busy} onClick={onDelete} aria-label={`Confirm deleting ${who}`}>
              Delete for good
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={() => setConfirming(true)} aria-label={`Delete ${who}`}>
            Delete
          </Button>
        )}
      </div>
    </li>
  );
}
