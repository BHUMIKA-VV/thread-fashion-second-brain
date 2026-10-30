"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";

import { useSession } from "@/features/auth/use-session";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { setCollectionPublic, setItemPublic } from "@/services/showcase";

/** The owner's "Show in showcase" switch. Other accounts can't publish, so they don't see it. */
export function PublishSwitch({
  kind,
  id,
  isPublic,
}: {
  kind: "item" | "collection";
  id: string;
  isPublic: boolean;
}) {
  const owner = useSession().data?.is_owner === true;
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: async (next: boolean) => {
      if (kind === "item") await setItemPublic(id, next);
      else await setCollectionPublic(id, next);
    },
    // Returning the refetch keeps the switch busy until the new state is back from the
    // server, so it never claims "private" (or "public") before that is true.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: kind === "item" ? ["items"] : ["collections"] }),
        queryClient.invalidateQueries({ queryKey: ["showcase"] }),
      ]),
  });
  if (!owner) return null;

  // Always the saved state: publishing is a public act, so no optimistic flip.
  const shown = isPublic;
  const href = kind === "item" ? `/showcase/${id}` : `/showcase/collections/${id}`;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-line py-3 text-sm">
      <button
        type="button"
        role="switch"
        aria-checked={shown}
        aria-busy={toggle.isPending}
        disabled={toggle.isPending}
        onClick={() => toggle.mutate(!isPublic)}
        className="inline-flex items-center gap-3 rounded-[2px]"
      >
        <span
          aria-hidden
          className={cn(
            "relative inline-block h-5 w-9 rounded-full border transition-colors",
            shown ? "border-indigo bg-indigo" : "border-ink/30 bg-paper-raised",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-3.5 rounded-full transition-[left] motion-reduce:transition-none",
              shown ? "left-[1.1rem] bg-paper-raised" : "left-0.5 bg-ink/40",
            )}
          />
        </span>
        Show in showcase
      </button>
      <span className="text-ink-muted" aria-live="polite">
        {toggle.isPending ? (
          "Saving…"
        ) : shown ? (
          <>
            Public.{" "}
            <Link href={href} className="text-ink underline underline-offset-4">
              View it as visitors do
            </Link>
          </>
        ) : kind === "item" ? (
          "Private: only you can see this piece."
        ) : (
          "Private. Once published, visitors see only the pieces in it that are public too."
        )}
      </span>
      {toggle.isError && (
        <p role="alert" className="w-full text-danger">
          {toggle.error instanceof ApiError ? toggle.error.message : "That didn't save."}
        </p>
      )}
    </div>
  );
}
