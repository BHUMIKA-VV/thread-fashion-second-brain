import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, test } from "./helpers/auth";
import { bandsPng, randomColour } from "./helpers/png";

// Moodboards: start a board from a collection, add text and colours (measured or chosen),
// reorder, survive a reload, and delete the board while the pieces stay in the archive.

type Rgb = [number, number, number];
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

function swatch(colour: Rgb): Buffer {
  return bandsPng(300, [
    { rows: 399, rgb: colour },
    { rows: 1, rgb: randomColour() }, // unique file per run
  ]);
}

async function uploadVia(request: APIRequestContext, png: Buffer, notes: string): Promise<string> {
  const response = await request.post("/api/items", {
    multipart: { file: { name: "swatch.png", mimeType: "image/png", buffer: png }, type: "fabric" },
  });
  expect(response.status()).toBe(201);
  const id: string = (await response.json()).id;
  expect((await request.patch(`/api/items/${id}`, { data: { notes } })).status()).toBe(200);
  // The board offers the colours Thread measured, so wait until the palette is there.
  await expect.poll(async () => (await (await request.get(`/api/items/${id}`)).json()).palette !== null).toBe(true);
  return id;
}

async function blockLabels(page: Page): Promise<(string | null)[]> {
  const articles = page.getByRole("list", { name: "Blocks on this board" }).getByRole("article");
  return articles.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")));
}

async function noOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, label).toBeLessThanOrEqual(0);
}

test("a board starts from a collection, takes text and colours, keeps its order, and is deleted without its pieces", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const token = `e2e${testInfo.project.name}${Date.now().toString(36)}`;
  const ids: string[] = [];
  let collectionId: string | null = null;
  let boardId: string | null = null;
  try {
    ids.push(await uploadVia(request, swatch([190, 30, 40]), `Silk ${token}`));
    ids.push(await uploadVia(request, swatch([30, 60, 150]), `Cotton ${token}`));
    const collection = await (await request.post("/api/collections", { data: { name: `Shortlist ${token}` } })).json();
    collectionId = collection.id;
    await request.post(`/api/collections/${collectionId}/items`, { data: { item_id: ids[0], note: "Client liked this" } });
    await request.post(`/api/collections/${collectionId}/items`, { data: { item_id: ids[1] } });

    await page.goto(`/collections/${collectionId}`);
    await page.getByRole("link", { name: "Make a board from this collection" }).click();
    await expect(page).toHaveURL(new RegExp(`/boards\\?from=${collectionId}$`));
    const form = page.getByRole("form", { name: "New board" });
    await expect(form.getByLabel("Start from")).toHaveValue(collectionId!);
    await form.getByLabel("Name").fill(`Board ${token}`);
    await form.getByRole("button", { name: "Create board" }).click();
    await expect(page).toHaveURL(/\/boards\/[0-9a-f-]{36}$/);
    boardId = page.url().split("/").pop()!;

    // The collection's pieces, in order, with its note as the caption.
    await expect(page.getByRole("heading", { level: 1, name: `Board ${token}` })).toBeAttached();
    expect(await blockLabels(page)).toEqual([`Silk ${token}`, `Cotton ${token}`]);
    await expect(page.getByRole("article", { name: `Silk ${token}` }).getByLabel("Caption")).toHaveValue("Client liked this");

    const aside = page.getByRole("complementary", { name: "Add to this board" });
    await aside.getByLabel("Note text").fill("Keep the gold to the borders.");
    await aside.getByRole("button", { name: "Add note" }).click();
    await aside.getByRole("radio", { name: "Heading" }).check();
    await aside.getByLabel("Heading text").fill("Colour story");
    await aside.getByRole("button", { name: "Add heading" }).click();
    await expect(page.getByRole("article", { name: "Heading: Colour story" })).toBeVisible();

    // A colour Thread measured on a piece, then one of our own.
    const measured = aside.getByRole("list", { name: "Colours from pieces on this board" }).getByRole("button").first();
    const measuredName = (await measured.getAttribute("aria-label"))!.replace(/^Add /, "");
    await measured.click();
    await expect(aside.getByRole("button", { name: `${measuredName}, on this board` })).toBeVisible();
    await aside.getByLabel("Hex").fill("#263b5e");
    await aside.getByRole("button", { name: "Add colour" }).click();
    await expect(page.getByRole("article", { name: "neel indigo #263B5E" })).toBeVisible();

    // The colour story follows: the measured colour taken from a piece matches it exactly.
    const story = page.getByRole("region", { name: "Colour story" });
    await expect(story).toContainText("Harmony:");
    const chosenList = story.getByRole("list", { name: "Chosen colours and their nearest measured colour" });
    await expect(chosenList.getByRole("listitem")).toHaveCount(2);
    await expect(chosenList.getByRole("listitem").first()).toContainText(/Matches .+ on (Silk|Cotton) e2e.+ \(difference 0\.0\)\./);
    await expect(story.getByRole("heading", { name: "Colour relationships" })).toBeVisible();

    // Move the heading to the top, one step at a time; each move is saved before the next.
    for (const index of [2, 1, 0]) {
      await page.getByRole("button", { name: "Move Heading: Colour story earlier" }).click();
      await expect.poll(async () => (await blockLabels(page)).indexOf("Heading: Colour story")).toBe(index);
    }
    await expect(page.getByRole("button", { name: "Move Heading: Colour story earlier" })).toBeDisabled();
    const expected = [
      "Heading: Colour story",
      `Silk ${token}`,
      `Cotton ${token}`,
      "Note: Keep the gold to the borders.",
      measuredName,
      "neel indigo #263B5E",
    ];
    expect(await blockLabels(page)).toEqual(expected);
    await page.reload();
    await expect(page.getByRole("list", { name: "Blocks on this board" }).getByRole("article")).toHaveCount(6);
    expect(await blockLabels(page)).toEqual(expected);

    await page.goto("/boards");
    await expect(page.getByRole("link", { name: new RegExp(`Board ${token}`) })).toContainText("6 blocks");

    await page.goto(`/boards/${boardId}`);
    await page.getByRole("button", { name: "Delete board" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete board" }).click();
    await expect(page).toHaveURL(/\/boards$/);
    boardId = null;
    for (const id of ids) expect((await request.get(`/api/items/${id}`)).status()).toBe(200);
    expect((await request.get(`/api/collections/${collectionId}`)).status()).toBe(200);
  } finally {
    if (boardId) await request.delete(`/api/boards/${boardId}`);
    if (collectionId) await request.delete(`/api/collections/${collectionId}`);
    for (const id of ids) await request.delete(`/api/items/${id}`);
  }
});

test("the boards pages pass WCAG checks and fit a phone", async ({ page, request }, testInfo) => {
  const token = `e2e${testInfo.project.name}${Date.now().toString(36)}`;
  const id = await uploadVia(request, swatch([120, 140, 60]), `Linen ${token}`);
  const board = await (await request.post("/api/boards", { data: { name: `A long board name for a client ${token}` } })).json();
  try {
    await request.post(`/api/boards/${board.id}/blocks`, { data: { kind: "heading", body: "Colour story" } });
    await request.post(`/api/boards/${board.id}/blocks`, { data: { kind: "piece", item_id: id, body: "For the lining" } });
    await request.post(`/api/boards/${board.id}/blocks`, { data: { kind: "colour", hex: "#d1291c" } });
    await request.post(`/api/boards/${board.id}/blocks`, { data: { kind: "note", body: "A".repeat(300) } });
    for (const path of ["/boards", `/boards/${board.id}`]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeAttached();
      if (path !== "/boards") await expect(page.getByRole("article", { name: "Heading: Colour story" })).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations, path).toEqual([]);
      for (const width of [360, 390]) {
        await page.setViewportSize({ width, height: 800 });
        await noOverflow(page, `${path} at ${width}px`);
      }
      await page.setViewportSize({ width: 1280, height: 800 });
    }
  } finally {
    await request.delete(`/api/boards/${board.id}`);
    await request.delete(`/api/items/${id}`);
  }
});
