import AxeBuilder from "@axe-core/playwright";
import type { Request } from "@playwright/test";

import { expect, test } from "./helpers/auth";

// The pricing page shows the server's plan catalogue: proposed pilot prices, nothing on sale.
// It reads GET /billing/plans and nothing else, and sends nothing.

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.describe("signed out", () => {
  test.use({ signedIn: false });

  test("a visitor finds the proposed plans in the footer, read from the API, with nothing to buy", async ({ page }) => {
    const requests: Request[] = [];
    page.on("request", (r) => requests.push(r));
    await page.goto("/how-it-works");
    await page.getByRole("navigation", { name: "More" }).getByRole("link", { name: "Pricing" }).click();
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.getByRole("heading", { level: 1, name: "Pricing" })).toBeVisible();

    const note = page.getByRole("note", { name: "About these prices" });
    await expect(note).toContainText("Proposed pilot pricing");
    await expect(note).toContainText("no payment can be made");

    const free = page.getByRole("region", { name: "Free", exact: true });
    await expect(free).toContainText("₹0");
    await expect(free).toContainText("Up to 25 pieces");
    await expect(free.getByRole("link", { name: "Create a free account" })).toHaveAttribute("href", "/signup");
    const studio = page.getByRole("region", { name: "Studio", exact: true });
    await expect(studio).toContainText("₹999");
    await expect(studio).toContainText("per 30 days");
    await expect(studio).toContainText("Up to 100 pieces");
    await expect(studio).toContainText("250 MB");
    await expect(studio.getByRole("link", { name: "Ask about Studio" })).toHaveAttribute("href", "/pilot#request");
    const pro = page.getByRole("region", { name: "Studio Pro" });
    await expect(pro).toContainText("₹2,499");
    await expect(pro).toContainText("Up to 250 pieces");
    await expect(pro).toContainText("1 GB");

    const table = page.getByRole("table", { name: "What each plan includes and allows" });
    await expect(table.getByRole("row", { name: /Outfit Studio/ }).getByRole("cell")).toHaveText(["Not included", "Included", "Included"]);
    await expect(page.getByText("Can I buy a plan today?")).toBeVisible();
    await expect(page.getByRole("link", { name: "terms", exact: true })).toHaveAttribute("href", "/terms");
    await expect(page.getByRole("link", { name: "privacy notice" })).toHaveAttribute("href", "/privacy");
    // Nothing on the page promises what Thread doesn't do.
    await expect(page.locator("main")).not.toContainText(/priority support|unlimited|annual plan available/i);

    const api = requests.map((r) => `${r.method()} ${new URL(r.url()).pathname}`).filter((c) => c.includes("/api/"));
    expect(api.filter((c) => c !== "GET /api/auth/session" && c !== "POST /api/metrics/view")).toContain("GET /api/billing/plans");
    expect(api.filter((c) => !c.startsWith("GET ") && c !== "POST /api/metrics/view")).toEqual([]);
  });

  test("the pricing page passes WCAG checks and fits a phone", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByRole("region", { name: "Studio Pro" })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations).toEqual([]);
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${width}px`).toBeLessThanOrEqual(0);
    }
    // The comparison scrolls inside its own region, which the keyboard can reach.
    const region = page.getByRole("region", { name: "Comparison table" });
    await region.focus();
    await expect(region).toBeFocused();
  });
});
