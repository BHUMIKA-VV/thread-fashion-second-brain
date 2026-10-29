import type { APIRequestContext } from "@playwright/test";

import { expect, test } from "./helpers/auth";
import { bandsPng, randomColour } from "./helpers/png";

type Rgb = [number, number, number];

function swatch(colour: Rgb): Buffer {
  return bandsPng(300, [
    { rows: 80, rgb: [240, 240, 240] },
    { rows: 259, rgb: colour },
    { rows: 60, rgb: [240, 240, 240] },
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
  return id;
}

test("search, filter, collect, reorder, annotate, then delete the collection and keep the pieces", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  // Unique per run and per project, because desktop and mobile run in parallel against one DB.
  const token = `e2e${testInfo.project.name}${Date.now().toString(36)}`;
  const tag = `weave${token}`;
  const ids: string[] = [];
  let collectionId: string | null = null;
  try {
    const first = await uploadVia(request, swatch([200, 30, 40]), `Stole ${token}`);
    ids.push(first);
    const second = await uploadVia(request, swatch([30, 60, 180]), `Kurta ${token}`);
    ids.push(second);
    const tagged = await request.patch(`/api/items/${first}/tags`, {
      data: { add: [{ category: "craft", tag }], remove: [] },
    });
    expect(tagged.status()).toBe(200);

    // Text search goes into the URL and finds both pieces by their notes.
    await page.goto("/gallery");
    await page.getByRole("searchbox", { name: "Search your library" }).fill(token);
    await expect(page).toHaveURL(new RegExp(`[?&]q=${token}`));
    await expect(page.getByText("2 pieces match")).toBeVisible();

    // A tag filter narrows to the tagged piece and says why it matched.
    await page.getByPlaceholder(/Filter by tag/).fill(`craft:${tag}`);
    await page.getByRole("button", { name: "Add filter" }).click();
    await expect(page).toHaveURL(new RegExp(`tag=craft%3A${tag}`));
    await expect(page.getByText("1 piece match")).toBeVisible();
    await expect(page.getByLabel("Why this matched")).toContainText(`Tag: craft · ${tag}`);

    // The filtered URL survives a reload.
    await page.reload();
    await expect(page.getByText("1 piece match")).toBeVisible();

    // Create a collection from the first piece, then add the second with its checkbox.
    const name = `Collection ${token}`;
    await page.goto(`/items/${first}`);
    const section = page.getByRole("region", { name: "Collections" });
    await section.getByRole("button", { name: "Add to collection" }).click();
    const create = section.getByRole("form", { name: "New collection with this piece" });
    await create.getByLabel("New collection").fill(name);
    await create.getByRole("button", { name: "Create & add" }).click();
    await expect(section.getByRole("checkbox", { name: new RegExp(name) })).toBeChecked();

    await page.goto(`/items/${second}`);
    const section2 = page.getByRole("region", { name: "Collections" });
    await section2.getByRole("button", { name: "Add to collection" }).click();
    const box = section2.getByRole("checkbox", { name: new RegExp(name) });
    await box.check();
    await expect(box).toBeChecked();

    const collections = await (await request.get("/api/collections")).json();
    collectionId = collections.find((c: { name: string }) => c.name === name).id;

    // Reorder with the accessible buttons and annotate; both persist across a reload.
    await page.goto(`/collections/${collectionId}`);
    const pieces = page.getByRole("list", { name: "Pieces in this collection" }).getByRole("article");
    await expect(pieces).toHaveCount(2);
    await expect(pieces.first()).toHaveAttribute("aria-label", `Stole ${token}`);
    await page.getByRole("button", { name: `Move Stole ${token} later` }).click();
    await expect(pieces.first()).toHaveAttribute("aria-label", `Kurta ${token}`);

    const kurta = page.getByRole("article", { name: `Kurta ${token}` });
    const note = kurta.getByLabel("Note in this collection");
    await note.fill("pair with the zari dupatta");
    await note.blur();
    await expect
      .poll(async () => (await (await request.get(`/api/collections/${collectionId}`)).json()).items[0].note)
      .toBe("pair with the zari dupatta");

    await page.reload();
    await expect(pieces.first()).toHaveAttribute("aria-label", `Kurta ${token}`);
    await expect(page.getByRole("article", { name: `Kurta ${token}` }).getByLabel("Note in this collection")).toHaveValue(
      "pair with the zari dupatta",
    );

    // Deleting asks first, then removes only the collection.
    await page.getByRole("button", { name: "Delete collection" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("The 2 pieces stay in your library");
    await dialog.getByRole("button", { name: "Delete collection" }).click();
    await expect(page).toHaveURL(/\/collections$/);
    expect((await request.get(`/api/collections/${collectionId}`)).status()).toBe(404);
    collectionId = null;
    for (const id of ids) expect((await request.get(`/api/items/${id}`)).status()).toBe(200);
  } finally {
    // Look the collection up by name too: a failure can happen after it was created in the UI
    // but before its id was read.
    const leftovers: { id: string; name: string }[] = await (await request.get("/api/collections")).json();
    for (const c of leftovers) if (c.id === collectionId || c.name === `Collection ${token}`) await request.delete(`/api/collections/${c.id}`);
    for (const id of ids) await request.delete(`/api/items/${id}`);
  }
});

test("navigation reaches every section from the header and footer", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const [label, path] of [
    ["Archive", "/gallery"],
    ["Collections", "/collections"],
    ["Upload", "/upload"],
  ] as const) {
    await nav.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(nav.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
  }
  const more = page.getByRole("navigation", { name: "More" });
  for (const [label, path] of [
    ["Overview", "/dashboard"],
    ["System", "/settings"],
  ] as const) {
    await more.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  }
  await page.getByRole("link", { name: "Thread, home" }).click();
  await expect(page).toHaveURL(/\/$/);
});
