import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./helpers/auth";

// The landing page for visitors: the way in (demo first, then your own wardrobe), the story
// sections, and the demo's sample collections. Signed in, the page stays about your archive.

const WCAG =["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const STORY = [
  "From scattered photos to an archive you can read",
  "What an archive looks like",
  "Try it on twenty museum pieces",
  "Who Thread is for",
  "Why Thread",
];

test.describe("signed out", () => {
  test.use({ signedIn: false });

  test("a visitor is offered the demo first, then their own wardrobe, then sign in", async ({ page }) => {
    await page.goto("/");
    const cover = page.getByRole("region", { name: "Thread" });
    const coverLinks = cover.getByRole("link");
    await expect(coverLinks.nth(0)).toHaveText(/Explore Thread/);
    await expect(coverLinks.nth(0)).toHaveAttribute("href", "/demo");
    await expect(coverLinks.nth(1)).toHaveText("Create your wardrobe");
    await expect(coverLinks.nth(1)).toHaveAttribute("href", "/signup");

    for (const name of STORY) await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();

    const closing = page.getByRole("region", { name: "Your archive starts with one photograph." });
    await expect(closing.getByRole("link")).toHaveText([/Explore the demo/, "Create your wardrobe", "Sign in"]);
    await expect(closing.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");

    // No invented social proof on the page.
    await expect(page.getByText(/testimonial|★|trusted by|\d+\+? users/i)).toHaveCount(0);

    // The sample collections lead into the demo.
    const invite = page.getByRole("region", { name: "Try it on twenty museum pieces" });
    await invite.getByRole("link", { name: /Indian textiles/ }).click();
    await expect(page).toHaveURL(/\/demo\/collections\/indian-textiles$/);
    await expect(page.getByRole("heading", { level: 1, name: "Indian textiles" })).toBeVisible();
  });

  test("the product tour shows real screenshots, each one loaded and described", async ({ page }) => {
    await page.goto("/");
    const tour = page.getByRole("region", { name: "What an archive looks like" });
    const shots = tour.getByRole("img");
    await expect(shots).toHaveCount(5);
    for (const shot of await shots.all()) {
      await shot.scrollIntoViewIfNeeded(); // next/image loads lazily
      await expect(shot).toHaveAttribute("alt", /^Screenshot: /);
      await expect.poll(() => shot.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    }
  });

  test("pages carry share cards, and robots.txt and the sitemap list only public pages", async ({ page, request }) => {
    await page.goto("/");
    const og = page.locator('meta[property="og:image"]');
    await expect(og).toHaveAttribute("content", /^https?:\/\/[^/]+\/screens\/og\.jpg$/);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /^https?:\/\/[^/]+\/?$/); // Next writes the root as the bare origin
    const image = await request.get(new URL((await og.getAttribute("content"))!).pathname);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toBe("image/jpeg");

    // A demo piece is shared with its own photograph.
    await page.goto("/demo/pieces/bandhani-sari");
    await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute("content", /\/demo\/images\/bandhani-sari\.webp$/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/demo\/pieces\/bandhani-sari$/);

    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toContain("Disallow: /gallery");
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toMatch(/Sitemap: https?:\/\/.+\/sitemap\.xml/);
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("/demo/pieces/bandhani-sari</loc>");
    expect(sitemap).not.toMatch(/\/(gallery|items|upload|settings)/);
  });

  test("the header and footer lead to the demo", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Demo" }).click();
    await expect(page).toHaveURL(/\/demo$/);
    await expect(page.getByRole("heading", { level: 1, name: "Explore Thread" })).toBeVisible();
    await page.getByRole("navigation", { name: "More" }).getByRole("link", { name: "Demo" }).click();
    await expect(page).toHaveURL(/\/demo$/);
  });

  test("the landing page passes WCAG checks and fits a phone, with motion reduced too", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 2, name: "Why Thread" })).toBeVisible();
    // With reduced motion nothing waits for an animation: every revealed block is fully opaque
    // without scrolling (toBeVisible alone accepts opacity 0, which hid these before).
    for (const name of ["Keep what stays with you", "Palette", "Craft & form", "Kindred pieces"]) {
      const heading = page.getByRole("heading", { level: 2, name, exact: true });
      await expect
        .poll(
          () =>
            heading.evaluate((el) => {
              let least = 1; // the lowest opacity of the heading and its ancestors
              for (let node: Element | null = el; node; node = node.parentElement) least = Math.min(least, Number(getComputedStyle(node).opacity));
              return least;
            }),
          { message: name },
        )
        .toBe(1);
    }
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations).toEqual([]);
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${width}px`).toBeLessThanOrEqual(0);
    }
  });
});

test("signed in, the landing page is about your archive, not the pitch", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Enter the archive" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Keep what stays with you" })).toBeVisible();
  for (const name of STORY) await expect(page.getByRole("heading", { level: 2, name })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Explore the demo" })).toHaveCount(0);
});
