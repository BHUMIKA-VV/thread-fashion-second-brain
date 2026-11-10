import AxeBuilder from "@axe-core/playwright";
import type { Page, Request } from "@playwright/test";

import { expect, test } from "./helpers/auth";

// The public demo is static: a JSON file and images under /demo, built offline. A visitor
// can browse, search and open every page without the API doing anything for them (the
// site header's own session check and the anonymous visit count are the only API calls),
// and nothing can be written.

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

function watchRequests(page: Page): Request[] {
  const seen: Request[] = [];
  page.on("request", (request) => seen.push(request));
  return seen;
}

function apiCalls(requests: Request[]): string[] {
  return requests
    .map((r) => `${r.method()} ${new URL(r.url()).pathname}`)
    .filter((call) => call.includes("/api/") && call !== "GET /api/auth/session" && call !== "POST /api/metrics/view");
}

async function noOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, label).toBeLessThanOrEqual(0);
}

test.describe("signed out", () => {
  test.use({ signedIn: false });

  test("a visitor searches the demo and opens a piece, an outfit and a collection without the API", async ({ page }) => {
    const requests = watchRequests(page);
    await page.goto("/demo");
    await expect(page.getByRole("heading", { level: 1, name: "Explore Thread" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "About this demo" })).toContainText("read-only demo");
    const grid = page.getByRole("list", { name: "Demo pieces" });
    await expect(grid.getByRole("listitem")).toHaveCount(30);

    await page.getByRole("searchbox", { name: "Search the demo" }).fill("bandhani");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(grid.getByRole("listitem")).toHaveCount(2);
    await page.getByRole("searchbox", { name: "Search the demo" }).fill("no-such-thing");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText("No demo pieces match")).toBeVisible();
    await page.getByRole("button", { name: "Clear search and filters" }).click();
    await expect(page.getByRole("list", { name: "Demo pieces" }).getByRole("listitem")).toHaveCount(30);

    await page.getByRole("list", { name: "Demo pieces" }).getByRole("link", { name: /Bandhani odhani/ }).click();
    await expect(page).toHaveURL(/\/demo\/pieces\/bandhani-odhani$/);
    await expect(page.getByRole("heading", { level: 1, name: /Bandhani odhani/ })).toBeVisible();
    await expect(page.getByRole("img", { name: /^Palette: .*%/ })).toBeVisible(); // the measured palette, with shares
    await expect(page.getByRole("heading", { name: "Kindred by look" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Kindred by palette" })).toBeVisible();
    await expect(page.getByRole("link", { name: /View the museum record/ })).toHaveAttribute("href", /^https:\/\/clevelandart\.org\//);
    // The image is the built demo file, optimised by Next, and actually loads.
    const hero = page.getByRole("img", { name: /^Bandhani odhani/ }).first();
    await expect(hero).toHaveJSProperty("complete", true);
    expect(await hero.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

    await page.goto("/demo/outfits/red-shawl-dark-coat");
    await expect(page.getByRole("heading", { level: 1, name: "Red shawl, dark coat" })).toBeVisible();
    await expect(page.getByText(/not a historical ensemble/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Outfit colours" })).toBeVisible();

    await page.goto("/demo/collections/indian-textiles");
    await expect(page.getByRole("heading", { level: 1, name: "Indian textiles" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Indian textiles pieces" }).getByRole("listitem")).toHaveCount(8);

    await page.goto("/demo/collections/silk-and-gold");
    await expect(page.getByRole("heading", { level: 1, name: "Silk and gold" })).toBeVisible();
    await page.getByRole("list", { name: "Silk and gold pieces" }).getByRole("link", { name: /Kimkhwab brocade, Benares/ }).click();
    await expect(page).toHaveURL(/\/demo\/pieces\/kimkhwab-benares$/);
    await expect(page.getByRole("link", { name: /View the museum record/ })).toHaveAttribute("href", "https://clevelandart.org/art/1925.720");

    expect(apiCalls(requests)).toEqual([]);
    // Nothing is written for the visitor; the visit count adds to an anonymous daily total only.
    const writes = requests.filter((r) => r.method() !== "GET" && new URL(r.url()).pathname !== "/api/metrics/view");
    expect(writes.map((r) => r.url())).toEqual([]);
  });

  test("every kind of demo page passes WCAG checks and fits a phone", async ({ page }) => {
    for (const path of ["/demo", "/demo/pieces/kashmir-shawl-boteh", "/demo/outfits/ochre-afternoon", "/demo/collections/colour-reds", "/demo/pieces/jama-with-poppies", "/demo/collections/painted-printed-cotton", "/demo/boards/wine-red-and-gold"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations, path).toEqual([]);
      for (const width of [360, 390]) {
        await page.setViewportSize({ width, height: 800 });
        await noOverflow(page, `${path} at ${width}px`);
      }
      await page.setViewportSize({ width: 1280, height: 800 });
    }
  });

  test("a visitor opens the sample board and presents it, with every piece credited", async ({ page }) => {
    const requests = watchRequests(page);
    await page.goto("/demo");
    await page.getByRole("link", { name: /Wine red and gold/ }).click();
    await expect(page).toHaveURL(/\/demo\/boards\/wine-red-and-gold$/);
    await expect(page.getByRole("heading", { level: 1, name: "Wine red and gold" })).toBeVisible();
    await expect(page.getByText(/nothing on it is for sale/)).toBeVisible();
    const blocks = page.getByRole("list", { name: "Blocks on this board" });
    await expect(blocks.getByRole("heading", { name: "Wine reds" })).toBeVisible();
    await expect(blocks).toContainText("The Cleveland Museum of Art, Purchase from the J. H. Wade Fund, 1925.498.");
    await expect(page.getByRole("heading", { name: "Colour story" })).toBeVisible();
    await expect(page.getByText(/^Harmony: Analogous/)).toBeVisible();

    await page.getByRole("link", { name: "Present" }).click();
    await expect(page).toHaveURL(/\/demo\/boards\/wine-red-and-gold\/present$/);
    const stage = page.getByRole("region", { name: /^Slide 1 of \d+: Wine red and gold$/ });
    await expect(stage).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const slide = page.getByRole("region", { name: /^Slide 3 of/ });
    await expect(slide).toContainText("Public domain (CC0)");
    await expect(slide.getByRole("link", { name: "https://clevelandart.org/art/1925.498" })).toBeVisible();
    await expect(page).toHaveURL(/#slide-3$/);
    // A reload keeps the place, and the page renders without a hydration warning.
    const errors: string[] = [];
    page.on("console", (m) => void (m.type() === "error" && errors.push(m.text())));
    await page.reload();
    await expect(page.getByRole("region", { name: /^Slide 3 of/ })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations).toEqual([]);
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await noOverflow(page, `present at ${width}px`);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/demo\/boards\/wine-red-and-gold$/);
    expect(errors).toEqual([]);
    expect(apiCalls(requests)).toEqual([]);
  });

  test("filters work from the keyboard", async ({ page }) => {
    await page.goto("/demo");
    const blue = page.getByRole("button", { name: "blue", exact: true });
    await blue.focus();
    await page.keyboard.press("Enter");
    await expect(blue).toHaveAttribute("aria-pressed", "true");
    const count = await page.getByRole("list", { name: "Demo pieces" }).getByRole("listitem").count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(20);
    await page.getByRole("searchbox", { name: "Search the demo" }).focus();
    await page.keyboard.type("kashmir");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("list", { name: "Demo pieces" }).getByRole("link").first()).toContainText(/Kashmir/);
  });

  test("unknown demo pages show the not-found page and are kept out of search engines", async ({ page }) => {
    // The status can be 200: once the layout has started streaming, Next keeps it and renders
    // the not-found UI with a noindex tag (docs: file-conventions/not-found, "status codes").
    for (const path of ["/demo/pieces/not-a-piece", "/demo/outfits/nope", "/demo/collections/nope", "/demo/boards/nope", "/demo/boards/nope/present"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: "This page doesn't exist" }), path).toBeVisible();
      await expect(page.locator('meta[name="robots"][content*="noindex"]').first(), path).toBeAttached();
    }
  });
});
