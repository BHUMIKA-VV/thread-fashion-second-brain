import { expect, test } from "./helpers/auth";
import { bandsPng, randomColour } from "./helpers/png";

type Colour = { hex: string; percentage: number };

test("an uploaded image shows its real extracted palette", async ({ page, request }) => {
  // 40% haldi yellow over 60% neel indigo. One random 1-pixel row makes the file unique per
  // run; at 0.25% it is below the 1% threshold and never becomes a palette colour.
  const png = bandsPng(300, [
    { rows: 160, rgb: [227, 160, 24] },
    { rows: 239, rgb: [38, 59, 94] },
    { rows: 1, rgb: randomColour() },
  ]);

  await page.goto("/upload");
  await page.getByRole("radio", { name: "Fabric swatch" }).click();
  await page.getByTestId("file-input").setInputFiles({ name: "bands.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Palette: neel indigo, haldi yellow" })).toBeVisible();
  await page.getByRole("link", { name: "View item" }).click();
  await expect(page).toHaveURL(/\/items\/[0-9a-f-]{36}$/);
  const itemId = page.url().split("/").pop()!;

  try {
    const section = page.getByRole("region", { name: "Colour palette" });
    await expect(section.getByRole("button", { name: /^Copy neel indigo\s*#263B5E/ })).toBeVisible();
    await expect(section.getByRole("button", { name: /^Copy haldi yellow\s*#E3A018/ })).toBeVisible();
    await expect(section.getByText("Harmony (heuristic):")).toBeVisible();

    // What is on screen matches what the API stored.
    const item = await (await request.get(`/api/items/${itemId}`)).json();
    const colours: Colour[] = item.palette.colors;
    expect(colours.map((c) => c.hex)).toEqual(["#263b5e", "#e3a018"]);
    expect(colours[0].percentage).toBeCloseTo(60, -0.5);
    expect(colours.reduce((sum, c) => sum + c.percentage, 0)).toBeCloseTo(100, 5);
    for (const colour of colours) {
      await expect(section.getByText(`${colour.hex.toUpperCase()} · ${colour.percentage}%`)).toBeVisible();
    }

    // PNG export is a real image download.
    const card = await request.get(`/api${item.palette_card_url}`);
    expect(card.status()).toBe(200);
    expect(card.headers()["content-type"]).toBe("image/png");
    await expect(section.getByRole("link", { name: "Export card" })).toHaveAttribute("download", "");
  } finally {
    await request.delete(`/api/items/${itemId}`);
  }
});
