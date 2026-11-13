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
  await expect(page.getByText(/^Paid until /)).toBeVisible();
  await expect(page.getByRole("table", { name: "Your recent payments" })).toContainText("₹999");

  // What the page shows is what the server recorded.
  await page.reload();
  await expect(page.getByText("Studio", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/^Paid until /)).toBeVisible();
  const me = await (await page.request.get("/api/billing/account")).json();
  expect(me.plan_id).toBe("studio");
});

test("closing, declining and an authorisation alone change nothing", async ({ page }) => {
  await page.goto("/account/billing");
  const pay = page.getByRole("button", { name: "Pay ₹999 for Studio" });
  const checkout = page.getByRole("dialog", { name: "Test checkout" });

  await pay.click();
  await checkout.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("status")).toHaveText("Checkout was closed. Nothing was charged.");

  await pay.click();
  await checkout.getByRole("button", { name: "Decline (test)" }).click();
  await expect(page.getByRole("status")).toContainText("That attempt didn't go through");
  await checkout.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("The payment didn't go through (BAD_REQUEST_ERROR). Nothing was charged.");

  await pay.click();
  await checkout.getByRole("button", { name: "Authorise only (test)" }).click();
  await expect(page.getByRole("status")).toContainText("so your plan hasn't changed");

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
