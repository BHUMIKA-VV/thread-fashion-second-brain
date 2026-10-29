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

async function uploadVia(request: APIRequestContext, png: Buffer, type = "fabric"): Promise<string> {
  const response = await request.post("/api/items", {
    multipart: { file: { name: "swatch.png", mimeType: "image/png", buffer: png }, type },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id;
}

test("tags: corrections and custom tags survive re-analysis", async ({ page, request }) => {
  test.setTimeout(120_000);
  const id = await uploadVia(request, swatch([200, 30, 40]));
  try {
    await page.goto(`/items/${id}`);
    const panel = page.getByRole("region", { name: "Tags" });
    await expect(panel.getByRole("heading", { name: "Tags" })).toBeVisible();

    const form = panel.getByRole("form", { name: "Add a tag" });
    await form.getByLabel("Category").selectOption("craft");
    await form.getByLabel("Tag").fill("Test Weave");
    await form.getByRole("button", { name: "Add tag" }).click();
    const chip = panel.getByTitle("custom");
    await expect(chip).toHaveText(/test weave/); // normalised to lowercase by the API

    await panel.getByRole("button", { name: "Re-analyse this image" }).click();
    await expect(panel.getByRole("button", { name: "Re-analyse this image" })).toHaveText(/Re-analyse$/, {
      timeout: 60_000,
    });
    await expect(panel.getByTitle("custom")).toHaveText(/test weave/); // survived re-analysis
    const tags = await (await request.get(`/api/items/${id}/tags`)).json();
    expect(tags.tags).toContainEqual(expect.objectContaining({ tag: "test weave", source: "user", custom: true }));

    await panel.getByRole("button", { name: "Remove test weave" }).click();
    await expect(panel.getByTitle("custom")).toHaveCount(0);
  } finally {
    await request.delete(`/api/items/${id}`);
  }
});

test("similarity modes explain their matches", async ({ page, request }) => {
  test.setTimeout(150_000);
  const ids: string[] = [];
  try {
    const query = await uploadVia(request, swatch([200, 30, 40]));
    ids.push(query);
    const blueIkat = await uploadVia(request, swatch([30, 60, 180]));
    ids.push(blueIkat);
    for (const id of ids) {
      const response = await request.patch(`/api/items/${id}/tags`, {
        data: { add: [{ category: "craft", tag: "ikat" }], remove: [] },
      });
      expect(response.status()).toBe(200);
    }

    await page.goto(`/items/${query}`);
    const section = page.getByRole("region", { name: "Similar pieces" });

    await section.getByRole("tab", { name: "Same fabric, different colour" }).click();
    const fabricCard = section.locator(`a[href="/items/${blueIkat}"]`);
    await expect(fabricCard).toBeVisible({ timeout: 90_000 }); // may wait for the model to load
    // Other tests running in parallel may add their own ikat pieces: check this test's card.
    const fabricResult = section.locator("li", { has: page.locator(`a[href="/items/${blueIkat}"]`) });
    await expect(fabricResult.getByText("Shares craft: ikat")).toBeVisible();
    await expect(fabricResult.getByText("Different dominant colour: blue vs red")).toBeVisible();

    await section.getByRole("tab", { name: "Same palette, different silhouette" }).click();
    const paletteCard = section.locator(`a[href="/items/${blueIkat}"]`);
    await expect(paletteCard).toBeVisible();
    const paletteResult = section.locator("li", { has: page.locator(`a[href="/items/${blueIkat}"]`) });
    await expect(paletteResult.getByText(/^ΔE \d+\.\d$/)).toBeVisible();
    await expect(
      paletteResult.getByText(/^Colour distance \d+\.\d \(CIEDE2000; lower is closer\)$/),
    ).toBeVisible();
  } finally {
    for (const id of ids) await request.delete(`/api/items/${id}`);
  }
});
