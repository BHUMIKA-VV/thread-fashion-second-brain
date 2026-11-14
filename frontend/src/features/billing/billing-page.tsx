"use client";

import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useSession } from "@/features/auth/use-session";
import { formatPrice } from "@/features/pricing/format";
import { ApiError } from "@/lib/api-client";
import { cancelPeriod, getBillingAccount, getPlans } from "@/services/billing";
import type { BillingAccount, BillingPeriod, CancelResult, PaidPlanId, PlanRead } from "@/types/api";

import { formatDate, formatDay, startsLater } from "./dates";
import { failureMessage } from "./messages";
import { PaymentHistory } from "./payment-history";
import { BILLING_KEY, isBusy, PAYMENTS_KEY, useCheckout, type CheckoutState } from "./use-checkout";

export { formatDate } from "./dates";

type PaidPlan = PlanRead & { id: PaidPlanId };

/** Shown inside an AuthGate, so the session is known. */
export function BillingPage() {
  const me = useSession().data;
  const account = useQuery({ queryKey: BILLING_KEY, queryFn: getBillingAccount });
  const catalogue = useQuery({ queryKey: ["billing", "plans"], queryFn: getPlans });
  const { state, buy } = useCheckout();

  if (account.isPending || catalogue.isPending) {
    return <div role="status" aria-label="Loading your plan" className="h-64 animate-pulse bg-ink/[0.05]" />;
  }
  if (account.isError || catalogue.isError) {
    return (
      <div role="alert" className="border-y border-danger/30 py-12 text-center">
        <p className="font-display text-xl">Thread couldn&apos;t load your plan.</p>
        <p className="mt-2 text-sm text-ink-muted">{(account.error ?? catalogue.error)?.message}</p>
        <Button
          className="mt-6"
          variant="secondary"
          onClick={() => {
            void account.refetch();
            void catalogue.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  const data = account.data;
  const paidPlans = catalogue.data.plans.filter((p): p is PaidPlan => p.id !== "free");

  return (
    <div className="space-y-14">
      <Section title="Your plan">
        <PlanSummary data={data} />
      </Section>

      {!data.exempt && (
        <Section title="Buy a period">
          <TestModeNote provider={data.checkout.provider} />
          <Offer data={data} verified={Boolean(me?.email_verified)} plans={paidPlans} state={state} buy={buy} />
          <CheckoutStatus state={state} />
        </Section>
      )}

      {!data.exempt && (
        <Section title="Payments">
          <PaymentHistory />
        </Section>
      )}
    </div>
  );
}

function PlanSummary({ data }: { data: BillingAccount }) {
  // Kept here, above the period it cancels, so its outcome stays on screen once that
  // period is gone from the account.
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: cancelPeriod,
    onSuccess: (result) => {
      queryClient.setQueryData(BILLING_KEY, result.account);
      void queryClient.invalidateQueries({ queryKey: PAYMENTS_KEY });
    },
  });
  if (data.exempt) {
    return (
      <>
        <p className="font-display text-3xl">Owner</p>
        <p className="mt-2 text-sm text-ink-muted">The owner of this Thread is never charged.</p>
      </>
    );
  }
  const current = data.current;
  return (
    <>
      <p className="font-display text-3xl">{current?.plan_name ?? "Free"}</p>
      <p className="mt-2 text-sm">
        {current
          ? `Active until ${formatDate(current.ends_at)}. Nothing renews or charges by itself.`
          : data.last_ended
            ? `${data.last_ended.plan_name} ${data.last_ended.ended_early ? "was cancelled" : `ended on ${formatDate(data.last_ended.ends_at)}`}. You're on Free; your pieces are kept.`
            : "You're on Free. Nothing is charged unless you buy a period."}
      </p>
      {data.ending_soon && current && (
        <p className="mt-3 border-l-2 border-warning pl-3 text-sm">
          {current.plan_name} ends on {formatDate(current.ends_at)}. Buy another period below to carry on without a gap.
        </p>
      )}
      {data.upcoming && <Upcoming period={data.upcoming} cancel={cancel} />}
      {cancel.isSuccess && (
        <p role="status" className="mt-3 text-sm">
          {cancel.data.refund === "processed"
            ? "Cancelled. Razorpay is refunding the payment in full; banks usually take a few working days."
            : "Cancelled. Razorpay is still processing the refund; your payments list shows when it's done."}
        </p>
      )}
      <p className="mt-4 text-sm text-ink-muted">
        There&apos;s nothing to cancel: each payment buys one period, and nothing is charged again unless you buy another.
      </p>
    </>
  );
}

type Cancel = UseMutationResult<CancelResult, Error, string>;

function Upcoming({ period, cancel }: { period: BillingPeriod; cancel: Cancel }) {
  return (
    <div className="mt-5 border border-line p-4">
      <p className="text-sm">
        Then <span className="font-medium">{period.plan_name}</span> from {formatDate(period.starts_at)} to {formatDate(period.ends_at)},
        already paid for.
      </p>
      {period.cancellable && <CancelUpcoming period={period} cancel={cancel} />}
    </div>
  );
}

/** Cancelling refunds money, so it takes a second, explicit step. */
function CancelUpcoming({ period, cancel }: { period: BillingPeriod; cancel: Cancel }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button variant="secondary" className="mt-3" onClick={() => setConfirming(true)}>
        Cancel this period…
      </Button>
    );
  }
  return (
    <div role="group" aria-label="Confirm cancelling" className="mt-3 space-y-3">
      <p className="text-sm">
        Cancel {period.plan_name} from {formatDate(period.starts_at)}? It hasn&apos;t started, so its payment is refunded in full. This
        can&apos;t be undone, but you can buy another period afterwards.
      </p>
      {cancel.isError && (
        <p role="alert" className="text-sm text-danger">
          {cancel.error instanceof ApiError ? cancel.error.message : "Thread couldn't cancel the period. Nothing changed."}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button className="bg-danger hover:bg-danger/90" disabled={cancel.isPending} onClick={() => cancel.mutate(period.payment_id)}>
          {cancel.isPending ? "Cancelling…" : "Cancel and refund"}
        </Button>
        <Button variant="ghost" disabled={cancel.isPending} onClick={() => setConfirming(false)}>
          Keep it
        </Button>
      </div>
    </div>
  );
}

function Offer({
  data,
  verified,
  plans,
  state,
  buy,
}: {
  data: BillingAccount;
  verified: boolean;
  plans: PaidPlan[];
  state: CheckoutState;
  buy: (planId: PaidPlanId) => Promise<void>;
}) {
  if (!data.checkout.available) {
    return <p className="mt-5 text-sm">Payments aren&apos;t set up on this Thread yet, so nothing can be bought.</p>;
  }
  if (!verified) return <p className="mt-5 text-sm">Confirm your email address before buying a plan.</p>;
  if (data.upcoming) {
    return <p className="mt-5 text-sm">Your next period is already paid for. You can buy another once it starts.</p>;
  }
  const later = startsLater(data.next_start_at);
  return (
    <>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {plans.map((plan) => (
          <li key={plan.id} className="border border-line p-5">
            <p className="font-display text-xl">{plan.name}</p>
            <p className="mt-1 text-sm text-ink-muted">
              {formatPrice(plan.price_paise)} for {plan.period_days} days, paid once
            </p>
            <Button className="mt-4" disabled={isBusy(state)} onClick={() => void buy(plan.id)}>
              Pay {formatPrice(plan.price_paise)} for {plan.name}
              {later ? ` from ${formatDay(data.next_start_at)}` : ""}
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-5 text-sm text-ink-muted">
        {later
          ? `A new period starts when the current one ends, on ${formatDate(data.next_start_at)}: paying early adds time, and choosing the other plan switches to it from then.`
          : "A period starts as soon as the payment is confirmed."}
      </p>
    </>
  );
}

function TestModeNote({ provider }: { provider: BillingAccount["checkout"]["provider"] }) {
  return (
    <p className="border-l-2 border-warning pl-3 text-sm">
      <strong className="font-medium">Test mode.</strong>{" "}
      {provider === "fake"
        ? "A local stand-in replaces Razorpay here: no money moves."
        : "Payments go through Razorpay in test mode: no real money moves."}
    </p>
  );
}

export function checkoutMessage(state: CheckoutState): string | null {
  switch (state.step) {
    case "idle":
      return null;
    case "starting":
      return "Starting checkout…";
    case "open":
      return state.failedCode
        ? `That attempt didn't go through. ${failureMessage(state.failedCode)} Try again in the checkout window, or close it.`
        : "Checkout is open.";
    case "verifying":
      return "Confirming the payment with Razorpay…";
    case "paid":
      return `Payment confirmed. ${state.period.plan_name} runs from ${formatDate(state.period.starts_at)} to ${formatDate(state.period.ends_at)}.`;
    case "pending":
      return "Razorpay hasn't confirmed this payment yet, so your plan hasn't changed. It starts once Razorpay confirms it; Razorpay refunds an authorisation that is never completed. Use Check again under Payments.";
    case "cancelled":
      return "Checkout was closed. Nothing was charged.";
    case "failed":
      return `The payment didn't go through${state.code ? ` (${state.code})` : ""}. ${failureMessage(state.code)} Nothing was charged.`;
    case "error":
      return state.message;
  }
}

/** What happened to the last checkout, announced to screen readers as it changes. */
function CheckoutStatus({ state }: { state: CheckoutState }) {
  const problem = state.step === "failed" || state.step === "error";
  return (
    <div className="mt-5 text-sm">
      <p role="status">{problem ? null : checkoutMessage(state)}</p>
      {/* An alert is announced when it appears, so it is only there while there's a problem. */}
      {problem && (
        <p role="alert" className="text-danger">
          {checkoutMessage(state)}
        </p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `billing-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="border-t border-ink pt-5">
      <h2 id={id} className="font-display text-2xl">
        {title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}
