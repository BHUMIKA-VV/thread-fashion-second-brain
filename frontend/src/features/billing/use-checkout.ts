"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import { ApiError } from "@/lib/api-client";
import { startCheckout, verifyCheckout } from "@/services/billing";
import type { BillingPeriod, PaidPlanId } from "@/types/api";

import { loadCheckout, scriptFor, type CheckoutSuccess } from "./checkout-script";

export const BILLING_KEY = ["billing", "account"] as const;

export type CheckoutState =
  | { step: "idle" }
  | { step: "starting"; planId: PaidPlanId }
  | { step: "open"; planId: PaidPlanId; failedCode?: string }
  | { step: "verifying"; planId: PaidPlanId }
  | { step: "paid"; period: BillingPeriod }
  | { step: "pending" }
  | { step: "cancelled" }
  | { step: "failed"; code: string | null }
  | { step: "error"; message: string };

const BUSY = new Set<CheckoutState["step"]>(["starting", "open", "verifying"]);
export const isBusy = (state: CheckoutState) => BUSY.has(state.step);

const message = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback);

/**
 * One checkout at a time: start an order, open Checkout, and have the server confirm what it
 * reports. The browser's word is never taken as payment: only the server's answer is shown.
 */
export function useCheckout() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<CheckoutState>({ step: "idle" });
  // Read synchronously, so a double click can't start two orders before a re-render.
  const busy = useRef(false);

  const finish = useCallback(
    (next: CheckoutState) => {
      busy.current = false;
      setState(next);
      void queryClient.invalidateQueries({ queryKey: BILLING_KEY });
    },
    [queryClient],
  );

  const verify = useCallback(
    async (planId: PaidPlanId, response: CheckoutSuccess) => {
      setState({ step: "verifying", planId });
      try {
        const result = await verifyCheckout({
          order_id: response.razorpay_order_id,
          payment_id: response.razorpay_payment_id,
          signature: response.razorpay_signature,
        });
        if (result.status === "paid" && result.period) finish({ step: "paid", period: result.period });
        else if (result.status === "pending") finish({ step: "pending" });
        else finish({ step: "failed", code: result.failure_code });
      } catch (error) {
        finish({ step: "error", message: message(error, "Thread couldn't confirm the payment.") });
      }
    },
    [finish],
  );

  const buy = useCallback(
    async (planId: PaidPlanId) => {
      if (busy.current) return;
      busy.current = true;
      setState({ step: "starting", planId });
      try {
        const order = await startCheckout(planId);
        const Razorpay = await loadCheckout(scriptFor(order.provider));
        let settled = false;
        let lastFailure: string | undefined;
        const checkout = new Razorpay({
          key: order.key_id,
          amount: order.amount_paise,
          currency: order.currency,
          name: "Thread",
          description: order.description,
          order_id: order.order_id,
          theme: { color: "#202321" },
          handler: (response) => {
            settled = true;
            void verify(planId, response);
          },
          modal: {
            ondismiss: () => {
              if (settled) return;
              finish(lastFailure ? { step: "failed", code: lastFailure } : { step: "cancelled" });
            },
          },
        });
        // Checkout stays open after a failed attempt, so the person can try again.
        checkout.on("payment.failed", (response) => {
          lastFailure = response.error?.code ?? "PAYMENT_FAILED";
          setState({ step: "open", planId, failedCode: lastFailure });
        });
        setState({ step: "open", planId });
        checkout.open();
      } catch (error) {
        finish({ step: "error", message: message(error, "Checkout could not be loaded. Nothing was charged.") });
      }
    },
    [finish, verify],
  );

  return { state, buy };
}
