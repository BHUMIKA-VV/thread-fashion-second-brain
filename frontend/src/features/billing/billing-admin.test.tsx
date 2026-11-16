import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountsAdmin } from "@/features/auth/accounts-admin";
import { apiErrorResponse, routeFetch } from "@/test/fetch-router";
import { renderWithQuery } from "@/test/render";
import type { AccountRead, AdminAccountBilling, AdminAction, BillingPayment, BillingSummary, Me } from "@/types/api";

import { BillingAdmin, BillingSelection } from "./billing-admin";

const MB = 1024 ** 2;
const OWNER: Me = { id: "o1", display_name: "Owner", email: "owner@example.com", email_verified: true, is_owner: true, has_password: true };
const ASHA: AccountRead = {
  id: "u1",
  display_name: "Asha",
  email: "asha@example.com",
  created_at: "2026-11-01T10:00:00Z",
  email_verified: true,
  disabled: false,
  is_owner: false,
  items: 4,
  plan_id: "studio",
  plan_until: "2026-12-13T12:00:00Z",
};

const SUMMARY: BillingSummary = {
  accounts: { free: 5, studio: 2, studio_pro: 1 },
  paid_ahead: 1,
  ended: 3,
  cancelled_refund: 1,
  cancelled_owner: 0,
  payments: { unfinished: 2, paid: 4, failed: 1, refunded: 1, refund_requested: 0 },
  totals: { paid_paise: 549_600, refunded_paise: 99_900, net_paise: 449_700 },
  mode: "test",
  provider: "fake",
};

const PAYMENT: BillingPayment = {
  id: "p9",
  plan_id: "studio",
  plan_name: "Studio",
  amount_paise: 99_900,
  currency: "INR",
  status: "created",
  method: null,
  created_at: "2026-11-13T12:00:00Z",
  paid_at: null,
  provider_payment_id: null,
  refunded_paise: 0,
  failure_code: null,
  refund: "none",
  refreshable: true,
};

const VIEW: AdminAccountBilling = {
  account: ASHA,
  billing: {
    plan_id: "studio",
    status: "active",
    exempt: false,
    current: {
      payment_id: "p1",
      plan_id: "studio",
      plan_name: "Studio",
      starts_at: "2026-11-13T12:00:00Z",
      ends_at: "2026-12-13T12:00:00Z",
      ended_early: false,
      cancellable: false,
    },
    upcoming: null,
    last_ended: null,
    ending_soon: false,
    next_start_at: "2026-12-13T12:00:00Z",
    usage: { pieces: 4, max_pieces: 100, bytes_used: 8 * MB, max_bytes: 250 * MB, earlier_limits: false, full: false },
    checkout: { available: true, provider: "fake", mode: "test" },
  },
};

const ACTION: AdminAction = {
  id: "a1",
  created_at: "2026-11-15T09:30:00Z",
  action: "payment_check",
  account_id: "u1",
  account_name: "Asha",
  payment_id: "p9",
  outcome: "no_change",
};

function serve(extra: Parameters<typeof routeFetch>[0] = {}, me: Me = OWNER) {
  return routeFetch({
    "GET /api/auth/session": () => Response.json(me),
    "GET /api/admin/accounts": () => Response.json([ASHA]),
    "GET /api/admin/billing/summary": () => Response.json(SUMMARY),
    "GET /api/admin/actions": () => Response.json([ACTION]),
    "GET /api/admin/accounts/u1/billing": () => Response.json(VIEW),
    "GET /api/admin/accounts/u1/payments": () => Response.json({ payments: [PAYMENT], next_before: null }),
    ...extra,
  });
}

function renderConsole() {
  return renderWithQuery(
    <BillingSelection>
      <AccountsAdmin />
      <BillingAdmin />
    </BillingSelection>,
  );
}

// jsdom has no layout, so no scrolling: opening an account scrolls the panel into view.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

describe("the owner's billing view", () => {
  it("shows figures from verified payments, marked as test mode", async () => {
    serve();
    renderConsole();
    const byPlan = await screen.findByLabelText("Accounts by plan");
    expect(byPlan).toHaveTextContent("Free5");
    expect(byPlan).toHaveTextContent("Studio2");
    expect(byPlan).toHaveTextContent("Studio Pro1");
    expect(screen.getByLabelText("Totals from verified payments")).toHaveTextContent("Paid₹5,496Refunded₹999Net₹4,497");
    expect(screen.getByText(/these amounts aren't real money/)).toBeInTheDocument();
  });

  it("shows each account's plan, and opens its billing from the list", async () => {
    serve();
    renderConsole();
    expect(await screen.findByText("Studio until Dec 13, 2026")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Billing of asha@example.com" }));
    const panel = await screen.findByRole("region", { name: "Billing of Asha" });
    expect(panel).toHaveTextContent("Studio, active until 13 December 2026.");
    expect(within(panel).getByText("4 of 100")).toBeInTheDocument();
    const payments = await within(panel).findByRole("list", { name: "Payments of Asha" });
    expect(payments).toHaveTextContent("Studio");
    // The owner's view has no account-holder receipt note and no way to refund or cancel.
    expect(within(panel).queryByText(/Thread doesn't issue invoices/)).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /refund|cancel/i })).not.toBeInTheDocument();
  });

  it("finds an account by what the owner types, and says when nothing matches", async () => {
    const fetch = serve({
      "GET /api/admin/billing/lookup?q=pay_B2": () => Response.json({ account_id: "u1" }),
      "GET /api/admin/billing/lookup?q=nobody": () => apiErrorResponse(404, "not_found", "No account or payment matches that."),
    });
    renderConsole();
    const box = await screen.findByLabelText("Find an account");
    fireEvent.change(box, { target: { value: "nobody" } });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No account or payment matches that.");

    fireEvent.change(box, { target: { value: "  pay_B2 " } });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    expect(await screen.findByRole("region", { name: "Billing of Asha" })).toBeInTheDocument();
    expect(fetch.mock.calls.map(([url]) => String(url))).toContain("/api/admin/billing/lookup?q=pay_B2");
  });

  it("checks one payment with Razorpay, and lists the owner's recent actions", async () => {
    const check = vi.fn(() => Response.json(PAYMENT));
    serve({ "POST /api/admin/accounts/u1/payments/p9/check": check });
    renderConsole();
    fireEvent.click(await screen.findByRole("button", { name: "Billing of asha@example.com" }));
    fireEvent.click(await screen.findByRole("button", { name: "Check with Razorpay" }));
    expect(await screen.findByText("No change yet.")).toBeInTheDocument();
    expect(check).toHaveBeenCalledTimes(1);

    const recent = screen.getByRole("list", { name: "Recent owner actions" });
    expect(recent).toHaveTextContent("Checked a payment with Razorpay · Asha · no change");
  });

  it("shows nothing to an account that isn't the owner", async () => {
    const fetch = serve({}, { ...OWNER, is_owner: false });
    renderConsole();
    expect(await screen.findByText("Only the owner of this Thread can manage accounts.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Billing" })).not.toBeInTheDocument();
    expect(fetch.mock.calls.map(([url]) => String(url)).filter((u) => u.startsWith("/api/admin"))).toEqual([]);
  });
});
