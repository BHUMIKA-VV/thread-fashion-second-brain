import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { bandsPng, randomColour } from "./helpers/png";

// Every screen: security headers, no CSP violations, and no automated WCAG 2.2 AA findings.
// Automated checks find only part of the problems; keyboard use is checked separately below.

async function uploadVia(request: APIRequestContext): Promise<string> {
  const png = bandsPng(300, [
    { rows: 100, rgb: [240, 240, 240] },
    { rows: 299, rgb: [38, 59, 94] },
    { rows: 1, rgb: randomColour() },
  ]);
  const response = await request.post("/api/items", {
    multipart: { file: { name: "swatch.png", mimeType: "image/png", buffer: png }, type: "fabric" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id;
}

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/Content Security Policy|Refused to|Permissions policy/i.test(text)) problems.push(text);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
  }));
}

test("every screen sends security headers, has no CSP violations and passes automated WCAG checks", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const itemId = await uploadVia(request);
  const collection = await (
    await request.post("/api/collections", { data: { name: `Quality ${Date.now()}-${Math.random()}` } })
  ).json();
  await request.post(`/api/collections/${collection.id}/items`, { data: { item_id: itemId } });
  try {
    const screens = [
      "/",
      "/dashboard",
      "/gallery",
      "/colour-lab",
      "/upload",
      "/collections",
      `/collections/${collection.id}`,
      `/items/${itemId}`,
      "/settings",
    ];
    for (const path of screens) {
      const problems = watchConsole(page);
      const response = await page.goto(path);
      const headers = response!.headers();
      expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
      expect(headers["x-content-type-options"], path).toBe("nosniff");
      expect(headers["referrer-policy"], path).toBe("same-origin");
      expect(headers["x-powered-by"], path).toBeUndefined();
      await page.waitForLoadState("networkidle");
      expect(problems, path).toEqual([]);
      expect(await axe(page), path).toEqual([]);
    }
  } finally {
    await request.delete(`/api/collections/${collection.id}`);
    await request.delete(`/api/items/${itemId}`);
  }
});

type FocusStop = { tag: string; name: string; outlined: boolean; visible: boolean } | null;

async function focused(page: Page): Promise<FocusStop> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40),
      outlined: (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none",
      visible: box.width > 0 && box.height > 0,
    };
  });
}

test("keyboard: skip link first, and every Tab stop is visible with a focus outline", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "keyboard navigation is a desktop concern");
  test.setTimeout(120_000);
  const itemId = await uploadVia(request);
  try {
    await page.goto("/gallery");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Tab");
    expect((await focused(page))?.name).toBe("Skip to content");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    const afterSkip = await page.evaluate(() => !!document.activeElement?.closest("main"));
    expect(afterSkip, "after the skip link, focus moves into the main content").toBe(true);

    for (const path of ["/gallery", `/items/${itemId}`, "/upload"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const seen: string[] = [];
      for (let i = 0; i < 45; i++) {
        await page.keyboard.press("Tab");
        const stop = await focused(page);
        if (!stop) continue; // wrapped past the end of the page
        const label = `${path} #${i} <${stop.tag}> "${stop.name}"`;
        expect(stop.visible, `${label} is visible`).toBe(true);
        expect(stop.outlined, `${label} shows a focus outline`).toBe(true);
        seen.push(label);
      }
      expect(new Set(seen).size, `${path}: focus keeps moving (no trap)`).toBeGreaterThan(8);
    }
  } finally {
    await request.delete(`/api/items/${itemId}`);
  }
});
