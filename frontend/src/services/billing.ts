import { apiFetch } from "@/lib/api-client";
import type { BillingAccount, CheckoutOrder, CheckoutResult, PaidPlanId, PlanCatalogue } from "@/types/api";

/** The plans, with prices defined by the server. Public. */
export const getPlans = () => apiFetch<PlanCatalogue>("/billing/plans");

/** The signed-in account's plan, paid periods and recent payments. */
export const getBillingAccount = () => apiFetch<BillingAccount>("/billing/account");

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Only the plan is sent: the server sets the amount from its own catalogue. */
export const startCheckout = (planId: PaidPlanId) => apiFetch<CheckoutOrder>("/billing/checkout", json({ plan_id: planId }));

/** What Checkout handed back; the server confirms it with Razorpay before granting anything. */
export const verifyCheckout = (body: { order_id: string; payment_id: string; signature: string }) =>
  apiFetch<CheckoutResult>("/billing/checkout/verify", json(body));
