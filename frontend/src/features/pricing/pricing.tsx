"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Minus } from "lucide-react";
import Link from "next/link";

import { Button, ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { getPlans } from "@/services/billing";
import type { PlanCatalogue, PlanRead } from "@/types/api";

import { formatPeriod, formatPrice, formatStorage } from "./format";

function storageText(plan: PlanRead): string {
  return plan.max_bytes === null ? "Not set yet" : formatStorage(plan.max_bytes);
}

function PlanCard({ plan, catalogue }: { plan: PlanRead; catalogue: PlanCatalogue }) {
  const paid = plan.price_paise > 0;
  const titleId = `plan-${plan.id}`;
  const included = catalogue.features.filter((f) => plan.features.includes(f.key));
  return (
    <section aria-labelledby={titleId} className={cn("flex flex-col border-t pt-6", plan.id === "studio" ? "border-t-2 border-ink" : "border-ink/30")}>
      <h2 id={titleId} className="text-[11px] uppercase tracking-[0.28em] text-ink-muted">
        {plan.name}
      </h2>
      <p className="mt-4 flex items-baseline gap-2">
        <span className="font-display text-5xl leading-none tracking-tight">{formatPrice(plan.price_paise)}</span>
        <span className="text-sm text-ink-muted">{formatPeriod(plan.period_days)}</span>
      </p>
      <p className="mt-4 leading-relaxed text-ink-muted">{plan.summary}</p>

      <dl className="mt-6 grid grid-cols-2 gap-x-4 border-y border-line py-4 text-sm">
        <dt className="text-ink-muted">Private archive</dt>
        <dd className="text-right">Up to {plan.max_pieces} pieces</dd>
        <dt className="mt-2 text-ink-muted">Storage</dt>
        <dd className="mt-2 text-right">{storageText(plan)}</dd>
      </dl>

      <ul aria-label={`${plan.name} includes`} className="mt-6 space-y-2.5 text-sm">
        {included.map((f) => (
          <li key={f.key} className="flex gap-2.5">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-sage" />
            <span>{f.label}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-8">
        {paid ? (
          catalogue.on_sale ? null : (
            <>
              <ButtonLink href="/pilot#request" className="w-full">
                Ask about {plan.name}
              </ButtonLink>
              <p className="mt-2 text-center text-xs text-ink-muted">Payments aren&apos;t open yet.</p>
            </>
          )
        ) : (
          <>
            <ButtonLink href="/signup" variant="secondary" className="w-full">
              Create a free account
            </ButtonLink>
            <p className="mt-2 text-center text-xs text-ink-muted">
              Or{" "}
              <Link href="/demo" className="underline underline-offset-4 hover:text-ink">
                explore the demo
              </Link>{" "}
              without one.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

function Comparison({ catalogue }: { catalogue: PlanCatalogue }) {
  const { plans, features } = catalogue;
  return (
    <section aria-labelledby="compare-title" className="mt-20">
      <h2 id="compare-title" className="font-display text-3xl">
        Compare the plans
      </h2>
      <p className="mt-2 text-sm text-ink-muted md:hidden">Scroll the table sideways to see every plan.</p>
      {/* Wide on a phone: the table scrolls inside its own focusable region. It is `relative` so
          the cells' screen-reader labels (absolutely positioned) are clipped with it instead of
          widening the page. */}
      <div role="region" aria-label="Comparison table" tabIndex={0} className="relative mt-6 overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
          <caption className="sr-only">What each plan includes and allows</caption>
          <thead>
            <tr className="border-b border-ink">
              <th scope="col" className="py-3 pr-4 font-normal text-ink-muted">
                <span className="sr-only">Feature</span>
              </th>
              {plans.map((p) => (
                <th key={p.id} scope="col" className="px-3 py-3 text-center font-medium">
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line">
              <th scope="row" className="py-3 pr-4 font-normal">
                Price
              </th>
              {plans.map((p) => (
                <td key={p.id} className="px-3 py-3 text-center">
                  {formatPrice(p.price_paise)}
                  {p.period_days !== null && <span className="block text-xs text-ink-muted">{formatPeriod(p.period_days)}</span>}
                </td>
              ))}
            </tr>
            <tr className="border-b border-line">
              <th scope="row" className="py-3 pr-4 font-normal">
                Pieces in your archive
              </th>
              {plans.map((p) => (
                <td key={p.id} className="px-3 py-3 text-center">
                  {p.max_pieces}
                </td>
              ))}
            </tr>
            <tr className="border-b border-line">
              <th scope="row" className="py-3 pr-4 font-normal">
                Storage for photographs
              </th>
              {plans.map((p) => (
                <td key={p.id} className="px-3 py-3 text-center">
                  {storageText(p)}
                </td>
              ))}
            </tr>
            {features.map((f) => (
              <tr key={f.key} className="border-b border-line align-top">
                <th scope="row" className="py-3 pr-4 font-normal">
                  {f.label}
                  <span className="mt-0.5 block text-xs text-ink-muted">{f.detail}</span>
                </th>
                {plans.map((p) => {
                  const has = p.features.includes(f.key);
                  return (
                    <td key={p.id} className="px-3 py-3 text-center">
                      {has ? <Check aria-hidden className="mx-auto size-4 text-sage" /> : <Minus aria-hidden className="mx-auto size-4 text-ink/30" />}
                      <span className="sr-only">{has ? "Included" : "Not included"}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The plans and their comparison, from the server's catalogue: prices are never written here. */
export function Pricing() {
  const catalogue = useQuery({ queryKey: ["billing", "plans"], queryFn: getPlans });
  if (catalogue.isPending) return <div role="status" aria-label="Loading the plans" className="h-[60vh] animate-pulse bg-ink/[0.05]" />;
  if (catalogue.isError) {
    return (
      <div role="alert" className="border-y border-line py-16 text-center">
        <p className="font-display text-2xl">The plans couldn&apos;t be loaded.</p>
        <p className="mt-2 text-sm text-ink-muted">Check your connection and try again.</p>
        <Button variant="secondary" className="mt-6" onClick={() => void catalogue.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  const data = catalogue.data;
  return (
    <div>
      {data.status === "proposed" && (
        <div role="note" aria-label="About these prices" className="border-l-2 border-clay bg-paper-raised px-5 py-4 text-sm leading-relaxed">
          <p className="font-medium text-ink">Proposed pilot pricing</p>
          <p className="mt-1 text-ink-muted">
            These prices are a proposal for Thread&apos;s pilot, not settled prices, and they are in Indian rupees. Nothing is on sale yet:
            no payment can be made and no account is charged. Until plans open, every account keeps the limits it has today.
          </p>
        </div>
      )}
      <div className="mt-12 grid gap-12 md:grid-cols-3 md:gap-8">
        {data.plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} catalogue={data} />
        ))}
      </div>
      <Comparison catalogue={data} />
    </div>
  );
}
