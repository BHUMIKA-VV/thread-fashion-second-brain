import type { APIRequestContext } from "@playwright/test";

import { expect, test } from "./helpers/auth";
import { bandsPng, randomColour } from "./helpers/png";

// The MVP's definition of done, as one user journey through the real stack (real palette
// extraction, real OpenCLIP embeddings and tags). Each step names the item it proves.

type Rgb = [number, number, number];

function striped(a: Rgb, b: Rgb): Buffer {
  const bands = [];
  for (let i = 0; i < 8; i++) bands.push({ rows: 50, rgb: i % 2 ? b : a });
  bands.push({ rows: 1, rgb: randomColour() }); // unique file per run
  return bandsPng(320, bands);
}

async function uploadVia(request: APIRequestContext, png: Buffer): Promise<string> {
  const response = await request.post("/api/items", {
    multipart: { file: { name: "neighbour.png", mimeType: "image/png", buffer: png }, type: "fabric" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id;
}

test("definition of done: upload, analysis, edits, similarity, search and collections", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(240_000);
  const token = `dod${testInfo.project.name}${Date.now().toString(36)}`;
  const created: string[] = [];
  let collectionId: string | null = null;
  try {
    // A neighbour with nearly the same colours, so similarity has something real to find.
    created.push(await uploadVia(request, striped([150, 25, 35], [235, 225, 205])));

    // 2. Upload from desktop or mobile (the real file input), and
    // 3. see a processing indicator while it is saved and analysed.
    await page.route("**/api/items", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.goto("/upload");
    await page.getByRole("radio", { name: "Fabric swatch" }).click();
    await page
      .getByTestId("file-input")
      .setInputFiles({ name: "ikat-stole.png", mimeType: "image/png", buffer: striped([160, 30, 40], [240, 230, 210]) });
    await expect(page.getByRole("progressbar", { name: "Uploading ikat-stole.png" })).toBeVisible();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.unroute("**/api/items");
    await page.getByRole("link", { name: "View item" }).click();
    await expect(page).toHaveURL(/\/items\/[0-9a-f-]{36}$/);
    const itemId = page.url().split("/").pop()!;
    created.push(itemId);
    await expect(
      page.getByText(/^(Awaiting analysis|Analysing|Partly analysed|Analysed)$/).first(),
      "a processing status is shown",
    ).toBeVisible();

    // 4. The real extracted palette (measured from the stripes, not placeholder colours).
    const palette = page.getByRole("region", { name: "Colour palette" });
    await expect(palette.getByRole("img", { name: "Palette proportions" })).toBeVisible();
    const colours = (await (await request.get(`/api/items/${itemId}`)).json()).palette.colors;
    expect(colours.length).toBeGreaterThanOrEqual(2);
    expect(colours.map((c: { family: string }) => c.family)).toContain("red");

    // 5. AI-generated tags (they appear once the model has loaded and tagged the piece).
    const tags = page.getByRole("region", { name: "Tags" });
    await expect(tags.locator('[title^="AI model score"]').first()).toBeVisible({ timeout: 150_000 });
    await expect(page.getByText("Analysed", { exact: true })).toBeVisible({ timeout: 30_000 });

    // 6. Edit tags and item metadata.
    const tagForm = tags.getByRole("form", { name: "Add a tag" });
    await tagForm.getByLabel("Category").selectOption("craft");
    await tagForm.getByLabel("Tag").fill(`weave ${token}`);
    await tagForm.getByRole("button", { name: "Add tag" }).click();
    await expect(tags.getByTitle("custom")).toContainText(`weave ${token}`);
    await page.getByLabel("Notes").fill(`Striped stole ${token}`);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("form", { name: "Details" }).getByText("Saved", { exact: true })).toBeVisible();

    // 7. Visually similar pieces from my own library.
    const similar = page.getByRole("region", { name: "Similar pieces" });
    await expect(similar.locator(`a[href="/items/${created[0]}"]`)).toBeVisible({ timeout: 60_000 });

    // 8. Filter and search the gallery.
    await page.goto(`/gallery?q=${encodeURIComponent(token)}&color=red`);
    await expect(page.locator(`a[href="/items/${itemId}"]`)).toBeVisible();
    await expect(page.getByLabel("Why this matched").first()).toContainText(token);

    // 9. Create a collection and organise pieces.
    await page.goto(`/items/${itemId}`);
    const collections = page.getByRole("region", { name: "Collections" });
    await collections.getByRole("button", { name: "Add to collection" }).click();
    const name = `Stripes ${token}`;
    const form = collections.getByRole("form", { name: "New collection with this piece" });
    await form.getByLabel("New collection").fill(name);
    await form.getByRole("button", { name: "Create & add" }).click();
    await expect(collections.getByRole("checkbox", { name: new RegExp(name) })).toBeChecked();
    collectionId = (await (await request.get("/api/collections")).json()).find((c: { name: string }) => c.name === name).id;
    await page.goto(`/collections/${collectionId}`);
    await expect(page.getByRole("article", { name: `Striped stole ${token}` })).toBeVisible();
  } finally {
    if (collectionId) await request.delete(`/api/collections/${collectionId}`);
    for (const id of created) await request.delete(`/api/items/${id}`);
  }
});
