"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useId,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { useSession } from "@/features/auth/use-session";
import { formatPrice } from "@/features/pricing/format";
import { ApiError } from "@/lib/api-client";
import {
  checkAccountPayment,
  getAccountBilling,
  getAccountPayments,
  getBillingSummary,
  listAdminActions,
  lookupBilling,
} from "@/services/auth";
import type { AdminAction, BillingPeriod } from "@/types/api";

import { ArchiveRoom } from "./archive-room";
import { formatDate } from "./dates";
import { PaymentHistory, type PaymentSource } from "./payment-history";

const SUMMARY_KEY = ["admin", "billing", "summary"] as const;
const ACTIONS_KEY = ["admin", "actions"] as const;

/** Which account's billing the owner has open, shared by the account list and this panel. */
const Selection = createContext<{
  selected: string | null;
  select: (id: string | null) => void;
}>({
  selected: null,
  select: () => {},
});

export function BillingSelection({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<string | null>(null);
  const select = (id: string | null) => {
    setSelected(id);
    if (id)
      requestAnimationFrame(() =>
        document
          .getElementById("owner-billing")
          ?.scrollIntoView({ block: "start" }),
      );
  };
  return (
    <Selection.Provider value={{ selected, select }}>
      {children}
    </Selection.Provider>
  );
}

export const useBillingSelection = () => useContext(Selection);

/** The owner's billing view: figures, a lookup, one account's billing, and recent actions.
 * Read-only apart from asking Razorpay again about one payment; nothing here moves money. */
export function BillingAdmin() {
  const me = useSession().data;
  const { selected } = useBillingSelection();
  if (!me?.is_owner) return null;
  return (
    <section
      id="owner-billing"
      aria-labelledby="owner-billing-title"
      className="mt-16 scroll-mt-24 border-t border-ink pt-5"
    >
      <h2 id="owner-billing-title" className="font-display text-2xl">
        Billing
      </h2>
      <Summary />
      <Lookup />
      {selected && <AccountBilling key={selected} id={selected} />}
      <RecentActions />
    </section>
  );
}

function Figure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-1.5 text-sm">
      <dt className="text-ink-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Summary() {
  const summary = useQuery({
    queryKey: SUMMARY_KEY,
    queryFn: getBillingSummary,
  });
  if (summary.isPending)
    return (
      <div
        role="status"
        aria-label="Loading billing figures"
        className="mt-5 h-40 animate-pulse bg-ink/[0.05]"
      />
    );
  if (summary.isError) {
    return (
      <p role="alert" className="mt-5 text-sm text-danger">
        Billing figures couldn&apos;t be loaded. {summary.error.message}
      </p>
    );
  }
  const s = summary.data;
  return (
    <div className="mt-5">
      <p className="border-l-2 border-warning pl-3 text-sm">
        <strong className="font-medium">Test mode.</strong>{" "}
        {s.provider === "fake"
          ? "A local stand-in replaces Razorpay"
          : "Razorpay is in test mode"}
        : these amounts aren&apos;t real money.
      </p>
      <div className="mt-5 grid gap-x-10 gap-y-6 sm:grid-cols-3">
        <dl aria-label="Accounts by plan">
          <Figure label="Free" value={s.accounts.free} />
          <Figure label="Studio" value={s.accounts.studio} />
          <Figure label="Studio Pro" value={s.accounts.studio_pro} />
          <Figure label="Back on Free after a period" value={s.ended} />
        </dl>
        <dl aria-label="Periods and payments">
          <Figure label="Paid ahead" value={s.paid_ahead} />
          <Figure label="Cancelled for a refund" value={s.cancelled_refund} />
          <Figure label="Paid" value={s.payments.paid} />
          <Figure label="Unfinished" value={s.payments.unfinished} />
          <Figure label="Failed" value={s.payments.failed} />
          <Figure label="Refunded" value={s.payments.refunded} />
          <Figure
            label="Refund requested"
            value={s.payments.refund_requested}
          />
        </dl>
        <dl aria-label="Totals from verified payments">
          <Figure label="Paid" value={formatPrice(s.totals.paid_paise)} />
          <Figure
            label="Refunded"
            value={formatPrice(s.totals.refunded_paise)}
          />
          <Figure label="Net" value={formatPrice(s.totals.net_paise)} />
        </dl>
      </div>
    </div>
  );
}

function Lookup() {
  const id = useId();
  const { select } = useBillingSelection();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const lookup = useMutation({
    mutationFn: lookupBilling,
    onSuccess: (result) => select(result.account_id),
    onSettled: () =>
      void queryClient.invalidateQueries({ queryKey: ACTIONS_KEY }),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (query.trim()) lookup.mutate(query.trim());
  };
  return (
    <form
      onSubmit={submit}
      className="mt-10"
      role="search"
      aria-label="Find an account's billing"
    >
      <label htmlFor={id} className="text-sm font-medium">
        Find an account
      </label>
      <p className="text-sm text-ink-muted">
        By email address, Thread payment id, or Razorpay payment or order id.
      </p>
      <div className="mt-2 flex flex-wrap gap-3">
        <input
          id={id}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={254}
          className="min-w-0 flex-1 border border-line bg-paper px-3 py-2 text-sm"
          autoComplete="off"
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={lookup.isPending || !query.trim()}
        >
          {lookup.isPending ? "Finding…" : "Find"}
        </Button>
      </div>
      {lookup.isError && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {lookup.error instanceof ApiError
            ? lookup.error.message
            : "That search didn't work."}
        </p>
      )}
    </form>
  );
}

function periodText(label: string, p: BillingPeriod): string {
  return `${label}: ${p.plan_name}, ${formatDate(p.starts_at)} to ${formatDate(p.ends_at)}${p.ended_early ? " (cancelled)" : ""}`;
}

function AccountBilling({ id }: { id: string }) {
  const { select } = useBillingSelection();
  const view = useQuery({
    queryKey: ["admin", "account-billing", id],
    queryFn: () => getAccountBilling(id),
  });
  if (view.isPending)
    return (
      <div
        role="status"
        aria-label="Loading the account's billing"
        className="mt-8 h-40 animate-pulse bg-ink/[0.05]"
      />
    );
  if (view.isError) {
    return (
      <p role="alert" className="mt-8 text-sm text-danger">
        That account&apos;s billing couldn&apos;t be loaded.{" "}
        {view.error.message}
      </p>
    );
  }
  const { account, billing } = view.data;
  const name = account.display_name;
  const source: PaymentSource = {
    key: ["admin", "account-payments", id],
    fetchPage: (before) => getAccountPayments(id, before),
    check: (paymentId) => checkAccountPayment(id, paymentId),
    related: [
      ["admin", "account-billing", id],
      SUMMARY_KEY,
      ACTIONS_KEY,
      ["admin", "accounts"],
    ],
    listLabel: `Payments of ${name}`,
    checkLabel: "Check with Razorpay",
    holder: false,
  };
  return (
    <section
      aria-label={`Billing of ${name}`}
      className="mt-8 border border-line p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-display text-xl">{name}</h3>
        <Button variant="ghost" onClick={() => select(null)}>
          Close
        </Button>
      </div>
      <p className="break-all text-sm text-ink-muted">
        {account.email ?? "No email (local development user)"}
      </p>
      <p className="mt-3 text-sm">
        {billing.exempt
          ? "The owner: never charged, no limits."
          : billing.current
            ? `${billing.current.plan_name}, active until ${formatDate(billing.current.ends_at)}.`
            : "Free."}
      </p>
      <ul className="mt-1 text-sm text-ink-muted">
        {billing.upcoming && (
          <li>{periodText("Paid ahead", billing.upcoming)}</li>
        )}
        {billing.last_ended && (
          <li>{periodText("Last period", billing.last_ended)}</li>
        )}
      </ul>
      <ArchiveRoom usage={billing.usage} roomier={null} />
      <div className="mt-6">
        <PaymentHistory source={source} />
      </div>
      <p className="mt-4 text-xs text-ink-muted">
        Checking with Razorpay brings Thread&apos;s record up to date. Refunds,
        cancellations and free periods can&apos;t be made from here.
      </p>
    </section>
  );
}

const ACTION_TEXT: Record<AdminAction["action"], string> = {
  billing_lookup: "Looked up billing",
  payment_check: "Checked a payment with Razorpay",
  account_disable: "Disabled an account",
  account_enable: "Enabled an account",
};

const OUTCOME_TEXT: Record<string, string> = {
  done: "done",
  found: "found",
  not_found: "nothing matched",
  no_change: "no change",
  updated: "updated",
  unavailable: "Razorpay unavailable",
  refused: "refused",
};

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

function RecentActions() {
  const actions = useQuery({
    queryKey: ACTIONS_KEY,
    queryFn: listAdminActions,
  });
  return (
    <div className="mt-12">
      <h3 className="font-display text-xl">Recent owner actions</h3>
      {actions.isPending && (
        <div
          role="status"
          aria-label="Loading owner actions"
          className="mt-3 h-16 animate-pulse bg-ink/[0.05]"
        />
      )}
      {actions.isError && (
        <p role="alert" className="mt-3 text-sm text-danger">
          Owner actions couldn&apos;t be loaded.
        </p>
      )}
      {actions.isSuccess &&
        (actions.data.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">Nothing yet.</p>
        ) : (
          <ul
            aria-label="Recent owner actions"
            className="mt-3 divide-y divide-line border-y border-line text-sm"
          >
            {actions.data.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap justify-between gap-x-6 py-2"
              >
                <span>
                  {ACTION_TEXT[a.action]}
                  {a.account_name ? ` · ${a.account_name}` : ""} ·{" "}
                  {OUTCOME_TEXT[a.outcome] ?? a.outcome}
                </span>
                <time dateTime={a.created_at} className="text-ink-muted">
                  {timeFormat.format(new Date(a.created_at))}
                </time>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
