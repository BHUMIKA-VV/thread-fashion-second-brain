import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./helpers/auth";

test.describe("signed out", () => {
  test.use({ signedIn: false });

  test("visitors reach How it works from the header and footer, and it passes WCAG checks", async ({ page }) => {
    await page.goto("/showcase");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "How it works" }).click();
    await expect(page).toHaveURL(/\/how-it-works$/);
    await expect(page.getByRole("heading", { level: 1, name: "How it works" })).toBeVisible();
    await expect(page.locator("main ol").getByRole("heading", { level: 2 })).toHaveCount(5);
    await expect(page.getByRole("navigation", { name: "More" }).getByRole("link", { name: "How it works" })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});

test("signed-in people find it in the footer", async ({ page }) => {
  await page.goto("/gallery");
  await page.getByRole("navigation", { name: "More" }).getByRole("link", { name: "How it works" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "How it works" })).toBeVisible();
});
