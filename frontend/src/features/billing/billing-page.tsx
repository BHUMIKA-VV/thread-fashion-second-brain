"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useSession } from "@/features/auth/use-session";
import { formatPrice } from "@/features/pricing/format";
import { getBillingAccount, getPlans } from "@/services/billing";
import type { BillingAccount, BillingPeriod, PaidPlanId, PlanRead } from "@/types/api";

import { BILLING_KEY, isBusy, useCheckout, type CheckoutState } from "./use-checkout";

const dateFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" });
export const formatDate = (iso: string) => dateFormat.format(new Date(iso));

const PAYMENT_STATUS: Record<BillingAccount["payments"][number]["status"], string> = {
  created: "Not completed",
  paid: "Paid",
  failed: "Failed",
  refunded: "Refunded",
};

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
        <p className="font-display text-3xl">{data.exempt ? "Owner" : (data.current?.plan_name ?? "Free")}</p>
        <p className="mt-2 text-sm text-ink-muted">
          {data.exempt
            ? "The owner of this Thread is never charged."
            : data.current
              ? `Paid until ${formatDate(data.current.ends_at)}. Nothing renews or charges by itself.`
              : "No paid period at the moment."}
        </p>
        {data.upcoming && <Upcoming period={data.upcoming} />}
      </Section>

      {!data.exempt && (
        <Section title="Buy a period">
          <TestModeNote provider={data.checkout.provider} />
          <Offer data={data} verified={Boolean(me?.email_verified)} plans={paidPlans} state={state} buy={buy} />
          <CheckoutStatus state={state} />
        </Section>
      )}

      {data.payments.length > 0 && <Payments payments={data.payments} />}
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
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-5 text-sm text-ink-muted">
        {data.current
          ? "A new period starts when the current one ends, so paying early adds time."
          : "A period starts as soon as the payment is confirmed."}
      </p>
    </>
  );
}

function Upcoming({ period }: { period: BillingPeriod }) {
  return (
    <p className="mt-2 text-sm">
      Then {period.plan_name} from {formatDate(period.starts_at)} to {formatDate(period.ends_at)}, already paid for.
    </p>
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

function Payments({ payments }: { payments: BillingAccount["payments"] }) {
  return (
    <Section title="Payments">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Your recent payments</caption>
          <thead className="text-ink-muted">
            <tr>
              <th scope="col" className="py-2 pr-4 font-normal">
                Date
              </th>
              <th scope="col" className="py-2 pr-4 font-normal">
                Plan
              </th>
              <th scope="col" className="py-2 pr-4 font-normal">
                Amount
              </th>
              <th scope="col" className="py-2 font-normal">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-t border-line">
                <td className="py-2 pr-4">{formatDate(p.paid_at ?? p.created_at)}</td>
                <td className="py-2 pr-4">{p.plan_name}</td>
                <td className="py-2 pr-4">{formatPrice(p.amount_paise)}</td>
                <td className="py-2">{PAYMENT_STATUS[p.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
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
        ? "That attempt didn't go through. Try again in the checkout window, or close it."
        : "Checkout is open.";
    case "verifying":
      return "Confirming the payment with Razorpay…";
    case "paid":
      return `Payment confirmed. ${state.period.plan_name} runs from ${formatDate(state.period.starts_at)} to ${formatDate(state.period.ends_at)}.`;
    case "pending":
      return "Razorpay hasn't confirmed this payment yet, so your plan hasn't changed. It starts once Razorpay confirms it; Razorpay refunds an authorisation that is never completed.";
    case "cancelled":
      return "Checkout was closed. Nothing was charged.";
    case "failed":
      return `The payment didn't go through${state.code ? ` (${state.code})` : ""}. Nothing was charged.`;
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
      <p role="alert" className="text-danger">
        {problem ? checkoutMessage(state) : null}
      </p>
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
