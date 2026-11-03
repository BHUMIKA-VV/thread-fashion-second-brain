import { readFileSync } from "node:fs";
import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import type { Page, Request } from "@playwright/test";

import { expect, test } from "./helpers/auth";

// The playground end to end, against the real API and image model: a visitor with no account
// chooses a photo, sees its measured palette, labelled suggestions and the closest demo pieces,
// downloads a swatch card drawn in the browser, and is shown the way to sign up or the pilot.
// The photo goes to the API once, as the request body, and nowhere else.

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
// A real demo photograph, so the real model has something to recognise.
// (Playwright runs from frontend/, and loads specs as CommonJS, so no import.meta here.)
const PHOTO = readFileSync(path.resolve("public/demo/images/bandhani-odhani.webp"));

async function analyse(page: Page) {
  await page.getByLabel("Photo to analyse").setInputFiles({ name: "odhani.webp", mimeType: "image/webp", buffer: PHOTO });
  await expect(page.getByRole("heading", { name: "What Thread measured" })).toBeFocused({ timeout: 30_000 });
  // The API warms the model up when it starts; until then the palette comes alone, and says so.
  await expect(async () => {
    const retry = page.getByRole("button", { name: /Try again with the model/ });
    if (await retry.isVisible()) await retry.click();
    await expect(page.getByRole("region", { name: "Kindred by look" })).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000 });
}

test.describe("a visitor", () => {
  test.use({ signedIn: false });

  test("tries a photo with no account and gets measured, labelled results", async ({ page }) => {
    const requests: Request[] = [];
    page.on("request", (r) => requests.push(r));
    await page.goto("/try");
    await expect(page.getByRole("heading", { level: 1, name: "Try Thread on your photo" })).toBeVisible();
    await expect(page.getByText(/No account, nothing kept\./)).toBeVisible();

    await analyse(page);
    await expect(page.getByText(/read as/)).toContainText(/suggested by the image model|as you chose/);
    await expect(page.getByRole("img", { name: "Palette proportions" })).toBeVisible();
    await expect(page.getByText(/Harmony \(heuristic\)/)).toBeVisible();
    const tags = page.getByRole("region", { name: "Suggested tags" });
    await expect(tags.getByText(/From an image model/)).toBeVisible();
    await expect(tags.getByText(/\d+%\)/).first()).toBeVisible();

    // The demo piece itself is its own closest look-alike.
    const look = page.getByRole("region", { name: "Kindred by look" });
    await expect(look.getByRole("link").first()).toHaveAttribute("href", "/demo/pieces/bandhani-odhani");
    await expect(page.getByRole("region", { name: "Kindred by palette" }).getByRole("link")).toHaveCount(6);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /Download swatch card/ }).click();
    expect((await download).suggestedFilename()).toBe("thread-swatch-card.png");

    await expect(page.getByRole("link", { name: /Create your archive/ })).toHaveAttribute("href", "/signup");
    await expect(page.getByRole("region", { name: "Keep pieces like this" }).getByRole("link", { name: /request a 20-minute demo call/ })).toHaveAttribute(
      "href",
      "/pilot#request",
    );

    // The photo went to the playground only, as the body, and no cookie went with it.
    const sent = requests.filter((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/playground/analyse");
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(await sent[0].headerValue("content-type")).toBe("image/webp"); // the file itself, no form around it
    // The API measured this very photo (1600 × 1127, as published in the demo). Playwright can't
    // show a blob request body, so the answer is the proof.
    await expect(page.getByText(/read as/)).toContainText("1600 × 1127 px");
    expect(await sent[0].headerValue("cookie")).toBeNull();
    const others = requests
      .filter((r) => r.method() !== "GET" && !r.url().startsWith("blob:") && !r.url().startsWith("data:"))
      .map((r) => new URL(r.url()).pathname)
      .filter((p) => p !== "/api/playground/analyse" && p !== "/api/metrics/view");
    expect(others).toEqual([]);
  });

  test("the results pass WCAG checks, work by keyboard and fit a phone", async ({ page }) => {
    await page.goto("/try");
    // Keyboard: the photo picker and the type are reachable without a mouse.
    await page.getByLabel("What is in the photo?").focus();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: /Choose a photo/ })).toBeFocused();
    await page.getByLabel("What is in the photo?").selectOption("fabric");

    await analyse(page);
    await expect(page.getByText(/read as/)).toContainText("Fabric swatch, as you chose");
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations).toEqual([]);
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${width}px`).toBeLessThanOrEqual(0);
    }
  });

  test("refuses a file that isn't a photo, and is reached from the landing page and footer", async ({ page }) => {
    await page.goto("/try");
    await page.getByLabel("Photo to analyse").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(page.getByRole("alert").filter({ hasText: "Choose" })).toHaveText("Choose a JPEG, PNG or WebP photo.");

    await page.goto("/");
    await page.getByRole("region", { name: "Try it on twenty museum pieces" }).getByRole("link", { name: "Try your own photo" }).click();
    await expect(page).toHaveURL(/\/try$/);
    await page.getByRole("navigation", { name: "More" }).getByRole("link", { name: "Try a photo" }).click();
    await expect(page).toHaveURL(/\/try$/);
  });

  test("the API refuses a disguised file and posts from another site", async ({ request }) => {
    const fake = await request.post("/api/playground/analyse", {
      data: Buffer.from("this is plain text pretending to be a picture"),
      headers: { "Content-Type": "image/png" },
    });
    expect(fake.status()).toBe(422);
    const crossSite = await request.post("/api/playground/analyse", {
      data: PHOTO,
      headers: { "Content-Type": "image/webp", Origin: "https://evil.example" },
    });
    expect(crossSite.status()).toBe(403);
  });
});
