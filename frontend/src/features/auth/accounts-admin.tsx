"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { listAccounts, setAccountDisabled } from "@/services/auth";

import { FormError } from "./form-parts";
import { useSession } from "./use-session";

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

/** The owner's moderation list: every account, and a switch to disable one. */
export function AccountsAdmin() {
  const me = useSession().data;
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ["admin", "accounts"], queryFn: listAccounts, enabled: !!me?.is_owner });
  const toggle = useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) => setAccountDisabled(id, disabled),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin", "accounts"] }),
  });

  if (!me?.is_owner) {
    return <p className="border-y border-line py-12 text-center text-ink-muted">Only the owner of this Thread can manage accounts.</p>;
  }
  if (accounts.isPending) return <div role="status" aria-label="Loading accounts" className="h-64 animate-pulse bg-ink/[0.05]" />;
  if (accounts.isError) {
    return (
      <div role="alert" className="border-y border-danger/30 py-12 text-center">
        <p className="font-display text-xl">Accounts could not be loaded.</p>
        <Button className="mt-6" variant="secondary" onClick={() => void accounts.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div>
      <FormError>{toggle.isError && (toggle.error instanceof ApiError ? toggle.error.message : "That didn't work.")}</FormError>
      <ul aria-label="Accounts" className="border-t border-ink">
        {accounts.data.map((account) => (
          <li key={account.id} className="flex flex-wrap items-center justify-between gap-4 border-b border-line py-4">
            <div className="min-w-0">
              <p className="font-display text-lg">
                {account.display_name}
                {account.is_owner && <span className="ml-2 text-xs uppercase tracking-[0.2em] text-ink-muted">Owner</span>}
              </p>
              <p className="break-all text-sm text-ink-muted">{account.email ?? "No email (local development user)"}</p>
              <p className="mt-1 text-xs text-ink-muted">
                Joined {dateFormat.format(new Date(account.created_at))} · {account.items}{" "}
                {account.items === 1 ? "piece" : "pieces"} · {account.email_verified ? "confirmed" : "not confirmed"}
                {account.disabled && <span className="text-danger"> · disabled</span>}
              </p>
            </div>
            {!account.is_owner && (
              <Button
                variant="secondary"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate({ id: account.id, disabled: !account.disabled })}
                aria-label={`${account.disabled ? "Enable" : "Disable"} ${account.email ?? account.display_name}`}
              >
                {account.disabled ? "Enable" : "Disable"}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
