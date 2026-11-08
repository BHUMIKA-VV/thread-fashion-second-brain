import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, test } from "./helpers/auth";
import { bandsPng, randomColour } from "./helpers/png";

// Present mode: full-window slides from a board or straight from a collection, driven by the
// keyboard, buttons or a swipe; internal detail stays hidden until asked for.

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function uploadVia(request: APIRequestContext, rgb: [number, number, number], notes: string): Promise<string> {
  const png = bandsPng(300, [
    { rows: 399, rgb },
    { rows: 1, rgb: randomColour() }, // unique file per run
  ]);
  const response = await request.post("/api/items", {
    multipart: { file: { name: "swatch.png", mimeType: "image/png", buffer: png }, type: "fabric" },
  });
  expect(response.status()).toBe(201);
  const id: string = (await response.json()).id;
  expect((await request.patch(`/api/items/${id}`, { data: { notes } })).status()).toBe(200);
  await expect.poll(async () => (await (await request.get(`/api/items/${id}`)).json()).palette !== null).toBe(true);
  return id;
}

const slide = (page: Page) => page.getByRole("region", { name: /^Slide \d+ of \d+/ });

async function swipe(page: Page, from: number, to: number) {
  const cdp = await page.context().newCDPSession(page);
  const y = 300;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from, y }] });
  for (const x of [from + (to - from) / 2, to]) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

test("a board is presented slide by slide, and Escape returns to it", async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const token = `e2e${testInfo.project.name}${Date.now().toString(36)}`;
  const silk = await uploadVia(request, [190, 30, 40], `Silk ${token}. Museum record X.1.`);
  const board = await (await request.post("/api/boards", { data: { name: `Present ${token}`, description: "For Meera" } })).json();
  try {
    await request.post(`/api/boards/${board.id}/blocks`, { data: { kind: "heading", body: "The silks" } });
    await request.post(`/api/boards/${board.id}/blocks`, { data: { kind: "piece", item_id: silk, body: "For the lining" } });
    await request.post(`/api/boards/${board.id}/blocks`, { data: { kind: "colour", hex: "#263b5e" } });

    await page.goto(`/boards/${board.id}`);
    await page.getByRole("toolbar", { name: "Present or export this board" }).getByRole("link", { name: "Present" }).click();
    await expect(page).toHaveURL(new RegExp(`/boards/${board.id}/present$`));
    await expect(slide(page)).toHaveAttribute("aria-label", `Slide 1 of 6: Present ${token}`);
    await expect(slide(page)).toBeFocused();
    await expect(slide(page).getByRole("heading", { name: `Present ${token}` })).toBeVisible();
    await expect(slide(page)).toContainText("For Meera");

    await page.keyboard.press("ArrowRight");
    await expect(slide(page)).toHaveAttribute("aria-label", "Slide 2 of 6: The silks");
    await page.keyboard.press("ArrowRight");
    await expect(slide(page).getByRole("heading", { name: "For the lining" })).toBeVisible();
    await expect(slide(page)).toContainText("Museum record X.1.");
    await expect(slide(page).getByRole("img", { name: `Silk ${token}. Museum record X.1.` })).toBeVisible();
    await expect(slide(page).getByLabel("Piece details")).toHaveCount(0);
    await page.getByRole("button", { name: "Show details" }).click();
    await expect(slide(page).getByLabel("Piece details")).toContainText("Type: fabric");
    await page.getByRole("button", { name: "Hide details" }).click();

    // A reload keeps the place.
    await expect(page).toHaveURL(/#slide-3$/);
    await page.reload();
    await expect(slide(page)).toHaveAttribute("aria-label", `Slide 3 of 6: Silk ${token}. Museum record X.1.`);

    await page.keyboard.press("End");
    await expect(slide(page)).toHaveAttribute("aria-label", "Slide 6 of 6: End of presentation");
    await page.keyboard.press("ArrowLeft");
    await expect(slide(page).getByRole("heading", { name: "Colour story" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(new RegExp(`/boards/${board.id}$`));
    await expect(page.getByRole("article", { name: "Heading: The silks" })).toBeVisible();
  } finally {
    await request.delete(`/api/boards/${board.id}`);
    await request.delete(`/api/items/${silk}`);
  }
});

test("a collection is presented directly, swipes on a touch screen, and passes WCAG checks", async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const token = `e2e${testInfo.project.name}${Date.now().toString(36)}`;
  const ids = [await uploadVia(request, [30, 60, 150], `Cotton ${token}`), await uploadVia(request, [120, 140, 60], `Linen ${token}`)];
  const collection = await (await request.post("/api/collections", { data: { name: `Shortlist${token}${token}` } })).json();
  try {
    await request.post(`/api/collections/${collection.id}/items`, { data: { item_id: ids[0], note: "Client liked this" } });
    await request.post(`/api/collections/${collection.id}/items`, { data: { item_id: ids[1] } });

    await page.goto(`/collections/${collection.id}`);
    await page.getByRole("link", { name: "Present this collection" }).click();
    await expect(page).toHaveURL(new RegExp(`/collections/${collection.id}/present$`));
    await expect(slide(page)).toHaveAttribute("aria-label", `Slide 1 of 4: Shortlist${token}${token}`);
    await expect(slide(page)).toContainText("2 pieces");

    let results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations, "cover").toEqual([]);

    await page.getByRole("button", { name: "Next slide" }).click();
    await expect(slide(page).getByRole("heading", { name: "Client liked this" })).toBeVisible();
    results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations, "piece").toEqual([]);

    // Swipe left for the next slide, right for the previous one.
    const width = page.viewportSize()!.width;
    await swipe(page, width * 0.8, width * 0.2);
    await expect(slide(page)).toHaveAttribute("aria-label", `Slide 3 of 4: Linen ${token}`);
    await swipe(page, width * 0.2, width * 0.8);
    await expect(slide(page)).toHaveAttribute("aria-label", `Slide 2 of 4: Cotton ${token}`);

    for (const w of [360, 390]) {
      await page.setViewportSize({ width: w, height: 800 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${w}px`).toBeLessThanOrEqual(0);
      // The slide scrolls on its own, so it is checked too: a long name must wrap, not run off.
      await page.keyboard.press("Home");
      const inside = await slide(page).evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(inside, `cover at ${w}px`).toBeLessThanOrEqual(0);
    }

    await page.getByRole("link", { name: "Exit" }).click();
    await expect(page).toHaveURL(new RegExp(`/collections/${collection.id}$`));
  } finally {
    await request.delete(`/api/collections/${collection.id}`);
    for (const id of ids) await request.delete(`/api/items/${id}`);
  }
});
