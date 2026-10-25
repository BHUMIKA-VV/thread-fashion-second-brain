import { expect, test, type APIRequestContext } from "@playwright/test";

import { bandsPng, randomColour } from "./helpers/png";

type Rgb = [number, number, number];

/** A "garment" band on a light backdrop; one random 1-px row keeps every file unique. */
function garment(colour: Rgb): Buffer {
  return bandsPng(300, [
    { rows: 80, rgb: [240, 240, 240] },
    { rows: 260, rgb: colour },
    { rows: 59, rgb: [240, 240, 240] },
    { rows: 1, rgb: randomColour() },
  ]);
}

async function uploadVia(request: APIRequestContext, name: string, png: Buffer): Promise<string> {
  const response = await request.post("/api/items", {
    multipart: { file: { name, mimeType: "image/png", buffer: png }, type: "garment" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id;
}

test("similar pieces ranks a close variant above a different image", async ({ page, request }) => {
  test.setTimeout(120_000); // the first search may wait for the image model to load
  const ids: string[] = [];
  try {
    const query = await uploadVia(request, "red.png", garment([200, 30, 40]));
    ids.push(query);
    const near = await uploadVia(request, "red-variant.png", garment([188, 42, 48]));
    ids.push(near);
    const far = await uploadVia(request, "blue.png", garment([30, 60, 180]));
    ids.push(far);

    await page.goto(`/items/${query}`);
    const section = page.getByRole("region", { name: "Similar pieces" });
    await expect(section.getByRole("heading", { name: "Similar pieces" })).toBeVisible();

    const nearLink = section.locator(`a[href="/items/${near}"]`);
    const farLink = section.locator(`a[href="/items/${far}"]`);
    await expect(nearLink).toBeVisible({ timeout: 90_000 });
    await expect(farLink).toBeVisible();
    await expect(section.locator(`a[href="/items/${query}"]`)).toHaveCount(0); // never itself

    // Ranking: the close variant comes before the blue garment, with a higher score.
    const hrefs = await section.locator("a[href^='/items/']").evaluateAll((links) =>
      links.map((l) => l.getAttribute("href")),
    );
    expect(hrefs.indexOf(`/items/${near}`)).toBeLessThan(hrefs.indexOf(`/items/${far}`));

    const api = await (await request.get(`/api/items/${query}/similar`)).json();
    const scores = Object.fromEntries(
      api.results.map((r: { item: { id: string }; similarity: number }) => [r.item.id, r.similarity]),
    );
    expect(scores[near]).toBeGreaterThan(scores[far]);
    expect(api.model).toMatch(/^open_clip\/ViT-B-32\/laion2b_s34b_b79k@/);

    // Clicking a match opens that item.
    await nearLink.click();
    await expect(page).toHaveURL(new RegExp(`/items/${near}$`));
  } finally {
    for (const id of ids) await request.delete(`/api/items/${id}`);
  }
});
