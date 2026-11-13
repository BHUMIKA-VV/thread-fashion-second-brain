import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiErrorResponse, routeFetch } from "@/test/fetch-router";
import { renderWithQuery } from "@/test/render";
import type { BillingAccount, CheckoutOrder, Me, PlanCatalogue } from "@/types/api";

import { BillingPage, checkoutMessage } from "./billing-page";
import type { CheckoutFailure, CheckoutSuccess, RazorpayOptions } from "./checkout-script";
import { isCheckoutPath } from "./paths";

// Checkout itself is replaced: the test plays Razorpay by calling the options' callbacks.
let opened: { options: RazorpayOptions; failed?: (r: CheckoutFailure) => void }[] = [];
const loadCheckout = vi.fn();
vi.mock("./checkout-script", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./checkout-script")>()),
  loadCheckout: (src: string) => loadCheckout(src),
}));

class FakeRazorpay {
  entry: (typeof opened)[number];
  constructor(options: RazorpayOptions) {
    this.entry = { options };
  }
  on(_: "payment.failed", handler: (r: CheckoutFailure) => void) {
    this.entry.failed = handler;
  }
  open() {
    opened.push(this.entry);
  }
}

const ME: Me = { id: "u1", display_name: "Asha", email: "asha@example.com", email_verified: true, is_owner: false, has_password: true };
const PERIOD = { plan_id: "studio" as const, plan_name: "Studio", starts_at: "2026-11-13T12:00:00Z", ends_at: "2026-12-13T12:00:00Z" };

function account(overrides: Partial<BillingAccount> = {}): BillingAccount {
  return {
    plan_id: "free",
    exempt: false,
    current: null,
    upcoming: null,
    payments: [],
    checkout: { available: true, provider: "fake", mode: "test" },
    ...overrides,
  };
}

const CATALOGUE: PlanCatalogue = {
  status: "proposed",
  on_sale: false,
  features: [],
  plans: [
    { id: "free", name: "Free", summary: "", price_paise: 0, currency: "INR", period_days: null, max_pieces: 25, max_bytes: null, features: [] },
    { id: "studio", name: "Studio", summary: "", price_paise: 99_900, currency: "INR", period_days: 30, max_pieces: 100, max_bytes: 1, features: [] },
    { id: "studio_pro", name: "Studio Pro", summary: "", price_paise: 249_900, currency: "INR", period_days: 30, max_pieces: 250, max_bytes: 2, features: [] },
  ],
};

const ORDER: CheckoutOrder = {
  payment_id: "p1",
  provider: "fake",
  key_id: "rzp_test_fakelocal",
  order_id: "order_A1",
  amount_paise: 99_900,
  currency: "INR",
  plan_id: "studio",
  plan_name: "Studio",
  description: "Studio, 30 days",
  starts_at: PERIOD.starts_at,
};

const SUCCESS: CheckoutSuccess = { razorpay_payment_id: "pay_B2", razorpay_order_id: "order_A1", razorpay_signature: "f".repeat(64) };

function serve(state: BillingAccount, extra: Parameters<typeof routeFetch>[0] = {}, me: Me = ME) {
  return routeFetch({
    "GET /api/auth/session": () => Response.json(me),
    "GET /api/billing/account": () => Response.json(state),
    "GET /api/billing/plans": () => Response.json(CATALOGUE),
    "POST /api/billing/checkout": () => Response.json(ORDER, { status: 201 }),
    ...extra,
  });
}

beforeEach(() => {
  opened = [];
  loadCheckout.mockResolvedValue(FakeRazorpay);
});
afterEach(() => vi.restoreAllMocks());

const payButton = () => screen.findByRole("button", { name: "Pay ₹999 for Studio" });

describe("BillingPage", () => {
  it("opens Checkout for the server's order, sending only the plan", async () => {
    const fetch = serve(account());
    renderWithQuery(<BillingPage />);
    expect(await screen.findByText(/Test mode\./)).toBeInTheDocument();
    fireEvent.click(await payButton());

    await vi.waitFor(() => expect(opened).toHaveLength(1));
    const checkout = fetch.mock.calls.find(([url]) => String(url) === "/api/billing/checkout")!;
    expect(JSON.parse(String(checkout[1]!.body))).toEqual({ plan_id: "studio" });
    expect(loadCheckout).toHaveBeenCalledWith("/api/billing/fake/checkout.js");
    expect(opened[0].options).toMatchObject({ key: "rzp_test_fakelocal", order_id: "order_A1", amount: 99_900, currency: "INR" });
    expect(screen.getByRole("button", { name: "Pay ₹999 for Studio" })).toBeDisabled();
  });

  it("shows the plan as paid only once the server has confirmed the payment", async () => {
    let state = account();
    const verify = vi.fn(() => {
      state = account({ plan_id: "studio", current: PERIOD });
      return Response.json({ status: "paid", period: PERIOD, failure_code: null });
    });
    serve(account(), { "GET /api/billing/account": () => Response.json(state), "POST /api/billing/checkout/verify": verify });
    renderWithQuery(<BillingPage />);
    fireEvent.click(await payButton());
    await vi.waitFor(() => expect(opened).toHaveLength(1));

    act(() => opened[0].options.handler(SUCCESS));
    expect(await screen.findByText(/Payment confirmed\. Studio runs from 13 November 2026 to 13 December 2026\./)).toBeInTheDocument();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Paid until 13 December 2026/)).toBeInTheDocument();
  });

  it("says nothing changed when the payment is only authorised", async () => {
    serve(account(), { "POST /api/billing/checkout/verify": () => Response.json({ status: "pending", period: null, failure_code: null }) });
    renderWithQuery(<BillingPage />);
    fireEvent.click(await payButton());
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    act(() => opened[0].options.handler(SUCCESS));
    expect(await screen.findByText(/hasn't confirmed this payment yet, so your plan hasn't changed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pay ₹999 for Studio" })).toBeEnabled();
  });

  it("reports a closed checkout, and a failed attempt once Checkout closes", async () => {
    serve(account());
    renderWithQuery(<BillingPage />);
    fireEvent.click(await payButton());
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    act(() => opened[0].options.modal.ondismiss());
    expect(await screen.findByText("Checkout was closed. Nothing was charged.")).toBeInTheDocument();

    fireEvent.click(await payButton());
    await vi.waitFor(() => expect(opened).toHaveLength(2));
    act(() => opened[1].failed!({ error: { code: "BAD_REQUEST_ERROR" } }));
    expect(await screen.findByText(/That attempt didn't go through/)).toBeInTheDocument();
    act(() => opened[1].options.modal.ondismiss());
    expect(await screen.findByRole("alert")).toHaveTextContent("The payment didn't go through (BAD_REQUEST_ERROR). Nothing was charged.");
  });

  it("shows the server's refusal when verifying fails", async () => {
    serve(account(), {
      "POST /api/billing/checkout/verify": () => apiErrorResponse(400, "signature_invalid", "This payment could not be confirmed. Nothing changed."),
    });
    renderWithQuery(<BillingPage />);
    fireEvent.click(await payButton());
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    act(() => opened[0].options.handler(SUCCESS));
    expect(await screen.findByRole("alert")).toHaveTextContent("This payment could not be confirmed. Nothing changed.");
  });

  it("says so when Checkout can't load, and lets the person try again", async () => {
    loadCheckout.mockRejectedValueOnce(new Error("Checkout could not be loaded."));
    serve(account());
    renderWithQuery(<BillingPage />);
    fireEvent.click(await payButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Checkout could not be loaded. Nothing was charged.");
    expect(screen.getByRole("button", { name: "Pay ₹999 for Studio" })).toBeEnabled();
  });

  it("offers nothing to buy when payments aren't set up, to the owner, or before confirming an email", async () => {
    serve(account({ checkout: { available: false, provider: "razorpay", mode: "test" } }));
    const { unmount } = renderWithQuery(<BillingPage />);
    expect(await screen.findByText(/Payments aren't set up on this Thread yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Pay/ })).not.toBeInTheDocument();
    unmount();
    vi.restoreAllMocks();

    serve(account({ exempt: true }));
    const owner = renderWithQuery(<BillingPage />);
    expect(await screen.findByText("The owner of this Thread is never charged.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Buy a period" })).not.toBeInTheDocument();
    owner.unmount();
    vi.restoreAllMocks();

    serve(account(), {}, { ...ME, email_verified: false });
    renderWithQuery(<BillingPage />);
    expect(await screen.findByText("Confirm your email address before buying a plan.")).toBeInTheDocument();
  });

  it("shows a period already paid ahead and the payments made", async () => {
    serve(
      account({
        plan_id: "studio",
        current: PERIOD,
        upcoming: { ...PERIOD, plan_id: "studio_pro", plan_name: "Studio Pro", starts_at: PERIOD.ends_at, ends_at: "2027-01-12T12:00:00Z" },
        payments: [{ id: "p1", plan_id: "studio", plan_name: "Studio", amount_paise: 99_900, currency: "INR", status: "paid", method: "upi", created_at: PERIOD.starts_at, paid_at: PERIOD.starts_at }],
      }),
    );
    renderWithQuery(<BillingPage />);
    expect(await screen.findByText(/Then Studio Pro from 13 December 2026 to 12 January 2027, already paid for\./)).toBeInTheDocument();
    expect(screen.getByText(/Your next period is already paid for/)).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Your recent payments" })).toHaveTextContent("Paid");
  });
});

describe("checkout path", () => {
  it("recognises the page that needs a full load", () => {
    expect([isCheckoutPath("/account/billing"), isCheckoutPath("/account/billing?x=1"), isCheckoutPath("/account"), isCheckoutPath("/account/billing-x")]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(checkoutMessage({ step: "idle" })).toBeNull();
  });
});
