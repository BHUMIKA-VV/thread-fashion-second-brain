import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test } from "./helpers/auth";

// The Indian colour names page and the structured data on public pages: every name with its
// shade and meaning, linked to demo pieces only where their measured colours are close, and
// schema.org data that parses and describes museum pieces as artworks, not products.

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function structuredData(page: Page): Promise<Record<string, unknown>[]> {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.map((text) => JSON.parse(text));
}

test.describe("a visitor", () => {
  test.use({ signedIn: false });

  test("reads the colour names, jumps to one and follows it to a demo piece", async ({ page }) => {
    await page.goto("/colours");
    await expect(page.getByRole("heading", { level: 1, name: "Indian colour names" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Colour names" }).getByRole("link")).toHaveCount(26);
    await expect(page.locator("main li[id]")).toHaveCount(26);

    await page.getByRole("navigation", { name: "Colour names" }).getByRole("link", { name: "kajal black" }).click();
    await expect(page).toHaveURL(/#kajal-black$/);
    const kajal = page.locator("#kajal-black");
    await expect(kajal).toBeInViewport();
    await expect(kajal.getByText("Kajal is kohl.")).toBeVisible();
    await expect(kajal.getByText("#1C1A1A")).toBeVisible();

    // A shade with no close demo piece says so instead of showing loose matches.
    await expect(page.locator("#haldi-yellow").getByText("No demo piece has a colour this close yet.")).toBeVisible();

    const first = kajal.getByRole("list", { name: "Demo pieces close to kajal black" }).getByRole("link").first();
    const href = await first.getAttribute("href");
    await first.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await page.getByRole("link", { name: "Thread's colour names" }).click();
    await expect(page).toHaveURL(/\/colours$/);
  });

  test("the page passes WCAG checks and fits a phone", async ({ page }) => {
    await page.goto("/colours");
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations).toEqual([]);
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${width}px`).toBeLessThanOrEqual(0);
    }
  });

  test("public pages carry structured data that parses", async ({ page }) => {
    await page.goto("/");
    expect((await structuredData(page)).map((d) => d["@type"])).toEqual(["WebSite"]);

    await page.goto("/demo/pieces/bandhani-odhani");
    const [piece] = await structuredData(page);
    expect(piece).toMatchObject({ "@context": "https://schema.org", "@type": "VisualArtwork", license: "https://creativecommons.org/publicdomain/zero/1.0/" });
    expect(String(piece.name)).toMatch(/Bandhani odhani/);

    await page.goto("/demo/collections/indian-textiles");
    const [collection] = await structuredData(page);
    expect(collection["@type"]).toBe("CollectionPage");
    expect((collection.mainEntity as { itemListElement: unknown[] }).itemListElement).toHaveLength(8);

    await page.goto("/colours");
    const [terms] = await structuredData(page);
    expect(terms["@type"]).toBe("DefinedTermSet");
    expect(terms.hasDefinedTerm as unknown[]).toHaveLength(26);
  });
});
