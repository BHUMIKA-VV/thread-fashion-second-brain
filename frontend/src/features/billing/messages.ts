import type { BillingPayment } from "@/types/api";

/** Razorpay's error codes, in plain words. Anything else gets the general sentence. */
const FAILURES: Record<string, string> = {
  BAD_REQUEST_ERROR: "The bank or payment app declined it, or the details didn't go through.",
  GATEWAY_ERROR: "The bank or payment network had a problem.",
  SERVER_ERROR: "Razorpay had a problem.",
};

export function failureMessage(code: string | null | undefined): string {
  return (code && FAILURES[code]) || "The payment didn't go through.";
}

/** What became of a payment, in one line. */
export function paymentStatus(payment: BillingPayment): string {
  if (payment.refund === "full") return "Refunded";
  if (payment.refund === "requested") return "Refund requested";
  if (payment.refund === "partial") return "Paid, partly refunded";
  if (payment.status === "paid") return "Paid";
  if (payment.status === "failed") return "Failed";
  return "Not completed";
}

/** The longer explanation shown under the row, if one is needed. */
export function paymentNote(payment: BillingPayment): string | null {
  if (payment.status === "failed") return `${failureMessage(payment.failure_code)} Nothing was charged.`;
  if (payment.status === "created") return "Not paid. If money left your account, check again: Razorpay may still be confirming it.";
  if (payment.refund === "requested") return "Cancelled. Razorpay is still sending the refund.";
  return null;
}
