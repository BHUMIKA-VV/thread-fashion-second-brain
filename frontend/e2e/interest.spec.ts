import AxeBuilder from "@axe-core/playwright";

import { expect, test, uniqueEmail } from "./helpers/auth";

// The way in for professionals and for people waiting on sign-up: the landing page leads to the
// studio pilot, the form keeps a registration only with consent, and only the owner sees it,
// counted apart from wardrobe interest, with a way to mark it contacted and delete it.

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.describe("a visitor", () => {
  test.use({ signedIn: false });

  test("finds the studio pilot from the landing page and footer, and registers", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("region", { name: "For your studio or boutique" }).getByRole("link", { name: /Join the studio pilot/ }).click();
    await expect(page).toHaveURL(/\/pilot$/);
    await expect(page.getByRole("heading", { level: 1, name: "Your pieces, organised and measured" })).toBeVisible();
    for (const name of ["What the pilot includes", "Not part of it yet", "Price"]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    }
    // No price is invented: without THREAD_PILOT_PRICE it is agreed in person.
    await expect(page.getByText(/^Agreed with you before we start\./)).toBeVisible();

    const form = page.getByRole("form", { name: "Register interest" });
    await form.getByLabel("What you do").selectOption("designer");
    await form.getByLabel("Your name (optional)").fill("E2E Designer");
    await form.getByLabel("Email", { exact: true }).fill(uniqueEmail("pilot"));
    await form.getByLabel(/How do you keep track/).fill("Swatch books and WhatsApp.");
    const submit = form.getByRole("button", { name: "Join the pilot list" });
    await expect(submit).toBeDisabled();
    await form.getByRole("checkbox", { name: /You may email me about the studio pilot/ }).check();
    await submit.click();
    await expect(page.getByRole("status").getByText("Thank you")).toBeVisible();

    await page.getByRole("navigation", { name: "More" }).getByRole("link", { name: "Studio pilot" }).click();
    await expect(page).toHaveURL(/\/pilot$/);
  });

  test("the pilot page passes WCAG checks, works by keyboard and fits a phone", async ({ page }) => {
    await page.goto("/pilot?for=wardrobe");
    await expect(page.getByRole("radio", { name: /My own wardrobe/ })).toBeChecked();
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations).toEqual([]);

    // Keyboard: the radios switch with arrow keys, and the hidden bot field is never reached.
    await page.getByRole("radio", { name: /My own wardrobe/ }).focus();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByRole("radio", { name: /My studio, label or boutique/ })).toBeChecked();
    await expect(page.getByLabel("What you do")).toBeVisible();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name)).not.toBe("website");
    }

    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${width}px`).toBeLessThanOrEqual(0);
    }
  });

  test("another site cannot post the form, and the owner's list is closed to visitors", async ({ request }) => {
    const body = { kind: "wardrobe", email: uniqueEmail("x"), consent: true };
    const crossSite = await request.post("/api/interest", { data: body, headers: { Origin: "https://evil.example" } });
    expect(crossSite.status()).toBe(403);
    expect((await request.get("/api/admin/interest")).status()).toBe(401);
  });
});

test.describe("a signed-in account that isn't the owner", () => {
  test("sees no interest on the accounts page, and the API refuses it", async ({ page }) => {
    await page.goto("/accounts");
    await expect(page.getByText("Only the owner of this Thread can manage accounts.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Interest" })).toHaveCount(0);
    expect((await page.request.get("/api/admin/interest")).status()).toBe(403);
  });
});

test.describe("the owner", () => {
  test.use({ asOwner: true });

  test("sees wardrobe and studio interest apart, marks one contacted and deletes it", async ({ page }) => {
    const email = uniqueEmail("studio-lead");
    const posted = await page.request.post("/api/interest", {
      data: { kind: "studio", role: "stylist", name: "E2E Stylist", email, message: "Bridal styling.", consent: true },
    });
    expect(posted.status()).toBe(202);

    await page.goto("/accounts");
    const interest = page.getByRole("region", { name: "Interest" });
    await expect(interest.getByText("Studio pilot", { exact: true })).toBeVisible();
    await expect(interest.getByText("Wardrobe early access")).toBeVisible();
    await expect(interest.getByText(/\d+ stylist/)).toBeVisible();
    const who = `E2E Stylist (${email})`;
    const row = interest.getByRole("listitem").filter({ hasText: email });
    await expect(row.getByText("Bridal styling.")).toBeVisible();

    await row.getByRole("button", { name: `Mark ${who} as contacted` }).click();
    await expect(row.getByText(/contacted /)).toBeVisible();

    await row.getByRole("button", { name: `Delete ${who}` }).click();
    await row.getByRole("button", { name: `Confirm deleting ${who}` }).click();
    await expect(interest.getByRole("listitem").filter({ hasText: email })).toHaveCount(0);
  });
});
