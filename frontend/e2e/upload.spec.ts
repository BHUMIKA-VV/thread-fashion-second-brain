import { expect, test } from "@playwright/test";

import { randomColour, solidPng } from "./helpers/png";

// These tests use the real dev stack and clean up the items they create.
test.describe.configure({ mode: "serial" });

test("upload → view → edit → find in gallery → delete", async ({ page, request }) => {
  const png = solidPng(320, 480, randomColour());

  await page.goto("/upload");
  await page.getByRole("radio", { name: "Fabric swatch" }).click();
  await page.getByTestId("file-input").setInputFiles({ name: "swatch.png", mimeType: "image/png", buffer: png });

  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "View item" }).click();
  await expect(page).toHaveURL(/\/items\/[0-9a-f-]{36}$/);
  const itemId = page.url().split("/").pop()!;

  try {
    // The badge reflects the real stage outcomes the API reports (e.g. "Partly analysed" on a
    // machine without the image model) rather than a hard-coded state.
    const status = (await (await request.get(`/api/items/${itemId}`)).json()).processing_status;
    const label = {
      queued: "Awaiting analysis",
      completed: "Analysed",
      partially_completed: "Partly analysed",
    }[status as string];
    expect(label, `unexpected status ${status}`).toBeTruthy();
    await expect(page.getByText(label!, { exact: true })).toBeVisible();
    await expect(page.getByText("320 × 480px")).toBeVisible();
    const image = page.getByRole("figure").getByRole("img");
    await expect(image).toHaveJSProperty("naturalWidth", 320);

    // Stored file is served through the API with safe headers.
    const original = await request.get(`/api/items/${itemId}/image?variant=original`);
    expect(original.status()).toBe(200);
    expect(original.headers()["content-type"]).toBe("image/png");
    expect(original.headers()["x-content-type-options"]).toBe("nosniff");

    // Edit details.
    await page.getByLabel("Notes").fill("Indigo test swatch");
    await page.getByLabel("Source URL").fill("https://example.test/swatch");
    await page.getByRole("button", { name: "Save changes" }).click();
    // Scoped to the form: Next keeps the previous (upload) route mounted but hidden,
    // and it has its own "Saved" badge.
    await expect(page.getByRole("form", { name: "Details" }).getByText("Saved", { exact: true })).toBeVisible();
    const saved = await (await request.get(`/api/items/${itemId}`)).json();
    expect(saved).toMatchObject({ type: "fabric", notes: "Indigo test swatch", source_url: "https://example.test/swatch" });

    // Gallery shows it under the Fabrics filter.
    await page.goto("/gallery");
    await page.getByRole("button", { name: "Fabrics" }).click();
    await expect(page.locator(`a[href="/items/${itemId}"]`)).toBeVisible();

    // Delete through the UI.
    await page.locator(`a[href="/items/${itemId}"]`).click();
    await page.getByRole("button", { name: "Delete item" }).click();
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await expect(page).toHaveURL(/\/gallery$/);
    await expect(page.locator(`a[href="/items/${itemId}"]`)).toHaveCount(0);
    expect((await request.get(`/api/items/${itemId}`)).status()).toBe(404);
  } finally {
    await request.delete(`/api/items/${itemId}`); // no-op (404) if the UI delete worked
  }
});

test("duplicate uploads point at the saved copy", async ({ page, request }) => {
  const png = solidPng(200, 200, randomColour());
  const file = { name: "dup.png", mimeType: "image/png", buffer: png };

  await page.goto("/upload");
  await page.getByTestId("file-input").setInputFiles(file);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const href = await page.getByRole("link", { name: "View item" }).getAttribute("href");
  const itemId = href!.split("/").pop()!;

  try {
    await page.getByTestId("file-input").setInputFiles(file);
    await expect(page.getByText("Already saved")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open the saved copy" })).toHaveAttribute("href", `/items/${itemId}`);
  } finally {
    await request.delete(`/api/items/${itemId}`);
  }
});

test("server rejects a fake image even when the browser calls it a PNG", async ({ page }) => {
  await page.goto("/upload");
  await page.getByTestId("file-input").setInputFiles({
    name: "not-really.png",
    mimeType: "image/png",
    buffer: Buffer.from("this is plain text pretending to be a picture"),
  });

  await expect(page.getByText("The file is not a readable image.")).toBeVisible();
  await expect(page.getByText("Not uploaded")).toBeVisible();
});
