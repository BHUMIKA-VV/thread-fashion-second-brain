import type { CheckoutOrder } from "@/types/api";

/** The part of Razorpay Checkout Thread uses (https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/). */
export type CheckoutSuccess = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
export type CheckoutFailure = { error?: { code?: string; reason?: string } };

export type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: CheckoutSuccess) => void;
  modal: { ondismiss: () => void };
  theme?: { color: string };
};

export type RazorpayCheckout = {
  open(): void;
  on(event: "payment.failed", handler: (response: CheckoutFailure) => void): void;
};

type RazorpayConstructor = new (options: RazorpayOptions) => RazorpayCheckout;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

export const RAZORPAY_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";
// The local stand-in, served by the API only when the fake provider is configured.
export const FAKE_SCRIPT = "/api/billing/fake/checkout.js";

export const scriptFor = (provider: CheckoutOrder["provider"]) => (provider === "fake" ? FAKE_SCRIPT : RAZORPAY_SCRIPT);

const loading = new Map<string, Promise<RazorpayConstructor>>();

/** Loads Checkout once per page. A failed load is forgotten, so trying again retries it. */
export function loadCheckout(src: string): Promise<RazorpayConstructor> {
  const known = loading.get(src);
  if (known) return known;
  const promise = new Promise<RazorpayConstructor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error("Checkout did not start.")));
    script.onerror = () => {
      script.remove();
      reject(new Error("Checkout could not be loaded."));
    };
    document.head.appendChild(script);
  });
  loading.set(src, promise);
  promise.catch(() => loading.delete(src));
  return promise;
}
