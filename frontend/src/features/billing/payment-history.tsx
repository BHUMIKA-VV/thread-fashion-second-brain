"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { formatPrice } from "@/features/pricing/format";
import { ApiError } from "@/lib/api-client";
import { getPayments, refreshPayment } from "@/services/billing";
import type { BillingPayment } from "@/types/api";

import { formatDate } from "./dates";
import { paymentNote, paymentStatus } from "./messages";
import { BILLING_KEY, PAYMENTS_KEY } from "./use-checkout";

const METHODS: Record<string, string> = { card: "Card", upi: "UPI", netbanking: "Netbanking", wallet: "Wallet", other: "Other" };

/** Every payment this account made, failed and unfinished ones included, newest first. */
export function PaymentHistory() {
  const history = useInfiniteQuery({
    queryKey: PAYMENTS_KEY,
    queryFn: ({ pageParam }) => getPayments(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before,
  });

  if (history.isPending) return <div role="status" aria-label="Loading payments" className="h-24 animate-pulse bg-ink/[0.05]" />;
  if (history.isError) {
    return (
      <p role="alert" className="text-sm text-danger">
        Thread couldn&apos;t load your payments. {history.error.message}
      </p>
    );
  }
  const payments = history.data.pages.flatMap((page) => page.payments);
  if (payments.length === 0) return <p className="text-sm text-ink-muted">No payments yet.</p>;

  return (
    <>
      <ul aria-label="Your payments" className="divide-y divide-line border-y border-line">
        {payments.map((payment) => (
          <PaymentRow key={payment.id} payment={payment} />
        ))}
      </ul>
      {history.hasNextPage && (
        <Button variant="secondary" className="mt-5" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
          {history.isFetchingNextPage ? "Loading…" : "Show more payments"}
        </Button>
      )}
      <p className="mt-5 text-sm text-ink-muted">
        Razorpay may email you a receipt for each payment; its reference matches the one shown here. Thread doesn&apos;t issue invoices.
      </p>
    </>
  );
}

function PaymentRow({ payment }: { payment: BillingPayment }) {
  const queryClient = useQueryClient();
  const refresh = useMutation({
    mutationFn: () => refreshPayment(payment.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PAYMENTS_KEY });
      void queryClient.invalidateQueries({ queryKey: BILLING_KEY });
    },
  });
  const note = paymentNote(payment);
  const label = `${payment.plan_name}, ${formatPrice(payment.amount_paise)}, ${formatDate(payment.paid_at ?? payment.created_at)}`;

  return (
    <li aria-label={label} className="py-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <p>
          <span className="font-medium">{payment.plan_name}</span> · {formatPrice(payment.amount_paise)} ·{" "}
          {formatDate(payment.paid_at ?? payment.created_at)}
        </p>
        <p className={payment.status === "failed" ? "text-danger" : undefined}>{paymentStatus(payment)}</p>
      </div>
      {note && <p className="mt-1 text-ink-muted">{note}</p>}
      <dl className="mt-1 flex flex-wrap gap-x-6 text-ink-muted">
        {payment.method && (
          <div className="flex gap-1">
            <dt>Method:</dt>
            <dd>{METHODS[payment.method] ?? "Other"}</dd>
          </div>
        )}
        {payment.refunded_paise > 0 && (
          <div className="flex gap-1">
            <dt>Refunded:</dt>
            <dd>{formatPrice(payment.refunded_paise)}</dd>
          </div>
        )}
        {payment.provider_payment_id && (
          <div className="flex gap-1">
            <dt>Reference:</dt>
            <dd className="break-all font-mono text-xs leading-5">{payment.provider_payment_id}</dd>
          </div>
        )}
      </dl>
      {payment.refreshable && (
        <div className="mt-2">
          <Button variant="secondary" className="px-3 py-1.5" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            {refresh.isPending ? "Checking…" : "Check again"}
          </Button>
          <p role="status" className="mt-1 text-ink-muted">
            {refresh.isSuccess && refresh.data.status === payment.status && refresh.data.refund === payment.refund ? "No change yet." : null}
          </p>
          {refresh.isError && (
            <p role="alert" className="mt-1 text-danger">
              {refresh.error instanceof ApiError ? refresh.error.message : "Thread couldn't check this payment."}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
