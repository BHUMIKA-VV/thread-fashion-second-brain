import { readFile } from "node:fs/promises";

import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Browser } from "@playwright/test";

import { expect, test } from "./helpers/auth";
import { bandsPng, randomColour } from "./helpers/png";

// The public showcase: the owner publishes, a signed-out visitor sees only that, and the
// swatch card downloads as a real 1080 x 1350 PNG. Owner pieces are deleted afterwards.
test.use({ asOwner: true });

async function uploadVia(request: APIRequestContext): Promise<string> {
  const png = bandsPng(320, [
    { rows: 200, rgb: [196, 40, 36] },
    { rows: 199, rgb: [38, 59, 94] },
    { rows: 1, rgb: randomColour() }, // unique file per run
  ]);
  const response = await request.post("/api/items", {
    multipart: { file: { name: "swatch.png", mimeType: "image/png", buffer: png }, type: "fabric" },
  });
  expect(response.status()).toBe(201);
  const id = (await response.json()).id;
  await expect
    .poll(async () => (await (await request.get(`/api/items/${id}`)).json()).palette?.colors?.length ?? 0)
    .toBeGreaterThan(0);
  return id;
}

async function visitorPage(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL, acceptDownloads: true });
  return { context, page: await context.newPage() };
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("a published piece is public, a private one is not, and the swatch card downloads", async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const shown = await uploadVia(request);
  const hidden = await uploadVia(request);
  const visitor = await visitorPage(browser, baseURL);
  try {
    // The owner publishes from the piece's own page.
    await page.goto(`/items/${shown}`);
    const toggle = page.getByRole("switch", { name: "Show in showcase" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("link", { name: "View it as visitors do" })).toHaveAttribute("href", `/showcase/${shown}`);

    // A signed-out visitor sees it, with its palette, and nothing about the private one.
    await visitor.page.goto(`/showcase/${shown}`);
    await expect(visitor.page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(visitor.page.getByRole("region", { name: "Palette" })).toBeVisible();
    expect((await visitor.context.request.get(`/api/showcase/items/${hidden}`)).status()).toBe(404);
    expect((await visitor.context.request.get(`/api/showcase/items/${hidden}/image`)).status()).toBe(404);
    expect((await visitor.context.request.get(`/api/items/${shown}`)).status()).toBe(401);
    const listed = await (await visitor.context.request.get("/api/showcase/items?limit=100")).json();
    const ids = listed.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(shown);
    expect(ids).not.toContain(hidden);
    expect(JSON.stringify(listed)).not.toContain("notes");

    const axe = await new AxeBuilder({ page: visitor.page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);

    // The swatch card is a real PNG of the right size.
    const [download] = await Promise.all([
      visitor.page.waitForEvent("download"),
      visitor.page.getByRole("button", { name: "Download swatch card" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`thread-swatch-${shown.slice(0, 6)}.png`);
    expect(pngSize(await readFile((await download.path())!))).toEqual({ width: 1080, height: 1350 });

    // Unpublishing hides it again.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await visitor.page.reload();
    await expect(visitor.page.getByText("This piece isn't in the showcase")).toBeVisible();
  } finally {
    await visitor.context.close();
    await request.delete(`/api/items/${shown}`);
    await request.delete(`/api/items/${hidden}`);
  }
});

test("a published collection shows only its published pieces", async ({ request, browser, baseURL }) => {
  const shown = await uploadVia(request);
  const hidden = await uploadVia(request);
  const collection = await (await request.post("/api/collections", { data: { name: `Showcase ${Date.now()}-${Math.random()}` } })).json();
  const visitor = await visitorPage(browser, baseURL);
  try {
    for (const id of [shown, hidden]) await request.post(`/api/collections/${collection.id}/items`, { data: { item_id: id } });
    await request.put(`/api/items/${shown}/showcase`, { data: { public: true } });
    await request.put(`/api/collections/${collection.id}/showcase`, { data: { public: true } });

    await visitor.page.goto(`/showcase/collections/${collection.id}`);
    await expect(visitor.page.getByRole("heading", { level: 1, name: collection.name })).toBeVisible();
    const pieces = visitor.page.getByRole("list", { name: "Pieces in this collection" }).getByRole("link");
    await expect(pieces).toHaveCount(1);
    await expect(pieces.first()).toHaveAttribute("href", `/showcase/${shown}`);
  } finally {
    await visitor.context.close();
    await request.delete(`/api/collections/${collection.id}`);
    await request.delete(`/api/items/${shown}`);
    await request.delete(`/api/items/${hidden}`);
  }
});

test.describe("other accounts", () => {
  test.use({ asOwner: false });

  test("can't publish anything and don't see the switch", async ({ page, request }) => {
    const id = await uploadVia(request);
    try {
      expect((await request.put(`/api/items/${id}/showcase`, { data: { public: true } })).status()).toBe(403);
      await page.goto(`/items/${id}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("switch", { name: "Show in showcase" })).toHaveCount(0);
    } finally {
      await request.delete(`/api/items/${id}`);
    }
  });
});
