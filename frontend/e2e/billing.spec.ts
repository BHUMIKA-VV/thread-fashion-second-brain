import { createHmac } from "node:crypto";

import { expect, test } from "./helpers/auth";

// Checkout on /account/billing, against the API's local stand-in for Razorpay
// (THREAD_PAYMENT_PROVIDER=fake in backend/scripts/e2e_server.py): no keys, no network, no money.

test("only the billing page lets Razorpay Checkout in, and opens it with a full page load", async ({ page }) => {
  const billing = (await page.goto("/account/billing"))!.headers();
  expect(billing["content-security-policy"]).toContain("script-src 'self' 'unsafe-inline'");
  expect(billing["content-security-policy"]).toContain("https://checkout.razorpay.com");
  expect(billing["content-security-policy"]).toContain("frame-src https://api.razorpay.com https://checkout.razorpay.com");
  expect(billing["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(billing["cross-origin-opener-policy"]).toBe("same-origin-allow-popups");
  expect(billing["x-frame-options"]).toBe("DENY");

  const account = (await page.goto("/account"))!.headers();
  expect(account["content-security-policy"]).not.toContain("razorpay");
  expect(account["content-security-policy"]).not.toContain("frame-src");
  expect(account["cross-origin-opener-policy"]).toBe("same-origin");

  const link = page.getByRole("link", { name: "Plan and payments" });
  await expect(link).toHaveAttribute("href", "/account/billing");
  const [response] = await Promise.all([page.waitForEvent("response", (r) => r.url().endsWith("/account/billing")), link.click()]);
  expect(response.request().resourceType()).toBe("document");
  await expect(page.getByRole("heading", { name: "Plan and payments", level: 1 })).toBeVisible();
});

test("a confirmed test payment starts a Studio period", async ({ page }) => {
  await page.goto("/account/billing");
  await expect(page.getByText(/Test mode\./)).toBeVisible();
  await expect(page.getByText("Free", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Pay ₹999 for Studio" }).click();
  const checkout = page.getByRole("dialog", { name: "Test checkout" });
  await expect(checkout).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay ₹2,499 for Studio Pro" })).toBeDisabled();
  await checkout.getByRole("button", { name: "Pay (test)" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Payment confirmed." })).toContainText("Studio runs from");
  await expect(page.getByText(/^Active until /)).toBeVisible();
  await expect(page.getByRole("list", { name: "Your payments" })).toContainText("₹999");

  // What the page shows is what the server recorded.
  await page.reload();
  await expect(page.getByText("Studio", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/^Active until /)).toBeVisible();
  const me = await (await page.request.get("/api/billing/account")).json();
  expect(me.plan_id).toBe("studio");
});

test("closing, declining and an authorisation alone change nothing", async ({ page }) => {
  await page.goto("/account/billing");
  const pay = page.getByRole("button", { name: "Pay ₹999 for Studio" });
  const checkout = page.getByRole("dialog", { name: "Test checkout" });
  // The checkout's own messages (each payment below has a status line of its own).
  const buying = page.getByRole("region", { name: "Buy a period" });

  await pay.click();
  await checkout.getByRole("button", { name: "Close" }).click();
  await expect(buying.getByRole("status")).toHaveText("Checkout was closed. Nothing was charged.");

  await pay.click();
  await checkout.getByRole("button", { name: "Decline (test)" }).click();
  await expect(buying.getByRole("status")).toContainText("That attempt didn't go through");
  await checkout.getByRole("button", { name: "Close" }).click();
  await expect(buying.getByRole("alert")).toHaveText(
    "The payment didn't go through (BAD_REQUEST_ERROR). The bank or payment app declined it, or the details didn't go through. Nothing was charged.",
  );

  await pay.click();
  await checkout.getByRole("button", { name: "Authorise only (test)" }).click();
  await expect(buying.getByRole("status")).toContainText("so your plan hasn't changed");

  const me = await (await page.request.get("/api/billing/account")).json();
  expect(me.plan_id).toBe("free");
  expect(me.current).toBeNull();
});

test("the server refuses a forged confirmation and a client-chosen price", async ({ request }) => {
  const order = await (await request.post("/api/billing/checkout", { data: { plan_id: "studio", amount_paise: 100 } })).json();
  expect(order.amount_paise).toBe(99_900);

  const forged = await request.post("/api/billing/checkout/verify", {
    data: { order_id: order.order_id, payment_id: "pay_forged123", signature: "0".repeat(64) },
  });
  expect(forged.status()).toBe(400);
  expect((await forged.json()).error.code).toBe("signature_invalid");
  expect((await (await request.get("/api/billing/account")).json()).plan_id).toBe("free");
});

test.describe("the owner", () => {
  test.use({ asOwner: true });

  test("is never charged", async ({ page, request }) => {
    await page.goto("/account/billing");
    await expect(page.getByText("The owner of this Thread is never charged.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Pay/ })).toHaveCount(0);
    const refused = await request.post("/api/billing/checkout", { data: { plan_id: "studio" } });
    expect(refused.status()).toBe(403);
  });
});

// The stand-in's webhook secret (FakeProvider.WEBHOOK_SECRET): public, and only honoured with
// the fake provider outside production.
const FAKE_WEBHOOK_SECRET = "thread-fake-webhook-not-a-secret";

test("a capture reported only by webhook still starts the period", async ({ page, request }) => {
  const order = await (await request.post("/api/billing/checkout", { data: { plan_id: "studio" } })).json();
  // Paid in Checkout, then the tab was closed: the browser never asked the server to verify.
  const paid = await (await request.post("/api/billing/fake/pay", { data: { order_id: order.order_id, outcome: "captured" } })).json();
  const body = JSON.stringify({
    entity: "event",
    account_id: "acc_test",
    event: "payment.captured",
    contains: ["payment"],
    payload: {
      payment: {
        entity: { id: paid.razorpay_payment_id, entity: "payment", amount: 99_900, currency: "INR", status: "captured", order_id: order.order_id, method: "upi" },
      },
    },
    created_at: Math.floor(Date.now() / 1000),
  });
  const send = (signature: string, eventId: string) =>
    request.post("/api/billing/webhooks/razorpay", {
      data: body,
      headers: { "content-type": "application/json", "x-razorpay-signature": signature, "x-razorpay-event-id": eventId },
    });
  const eventId = `evt_e2e${Date.now()}`;

  expect((await send("0".repeat(64), eventId)).status()).toBe(400);
  const signature = createHmac("sha256", FAKE_WEBHOOK_SECRET).update(body).digest("hex");
  const delivered = await send(signature, eventId);
  expect(delivered.status(), await delivered.text()).toBe(200);
  expect(await delivered.json()).toEqual({ status: "applied" });
  expect(await (await send(signature, eventId)).json()).toEqual({ status: "duplicate" });

  await page.goto("/account/billing");
  await expect(page.getByText(/^Active until /)).toBeVisible();
});

test("a period paid ahead can be cancelled for a full refund, after confirming", async ({ page }) => {
  await page.goto("/account/billing");
  const checkout = page.getByRole("dialog", { name: "Test checkout" });
  await page.getByRole("button", { name: "Pay ₹999 for Studio" }).click();
  await checkout.getByRole("button", { name: "Pay (test)" }).click();
  await expect(page.getByText(/^Active until /)).toBeVisible();

  // The next period starts when this one ends, and the button says so.
  const pro = page.getByRole("button", { name: /^Pay ₹2,499 for Studio Pro from / });
  await pro.click();
  await checkout.getByRole("button", { name: "Pay (test)" }).click();
  await expect(page.getByText(/, already paid for\./)).toBeVisible();

  await page.getByRole("button", { name: "Cancel this period…" }).click();
  await expect(page.getByRole("group", { name: "Confirm cancelling" })).toContainText("refunded in full");
  await page.getByRole("button", { name: "Cancel and refund" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cancelled." })).toContainText("refunding the payment in full");
  await expect(page.getByText(/, already paid for\./)).toHaveCount(0);

  const payments = page.getByRole("list", { name: "Your payments" });
  await expect(payments.getByRole("listitem")).toHaveCount(2);
  await expect(payments.getByRole("listitem").first()).toContainText("Refunded");
  await page.reload();
  await expect(page.getByText(/^Active until /)).toBeVisible();
  await expect(page.getByRole("list", { name: "Your payments" }).getByRole("listitem").first()).toContainText("Refunded");
});

test("an unfinished payment is listed and can be checked again", async ({ page, request }) => {
  const order = await (await request.post("/api/billing/checkout", { data: { plan_id: "studio" } })).json();
  await page.goto("/account/billing");
  const row = page.getByRole("list", { name: "Your payments" }).getByRole("listitem");
  await expect(row).toContainText("Not completed");
  await row.getByRole("button", { name: "Check again" }).click();
  await expect(row).toContainText("No change yet.");

  // Captured in Checkout, but the tab closed before Thread heard of it.
  await request.post("/api/billing/fake/pay", { data: { order_id: order.order_id, outcome: "captured" } });
  await row.getByRole("button", { name: "Check again" }).click();
  await expect(row).toContainText("Paid");
  await expect(page.getByText(/^Active until /)).toBeVisible();
});
