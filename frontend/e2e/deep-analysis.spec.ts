import type { APIRequestContext } from "@playwright/test";

import { expect, test } from "./helpers/auth";
import { bandsPng, randomColour } from "./helpers/png";

async function uploadVia(request: APIRequestContext): Promise<string> {
  const png = bandsPng(300, [
    { rows: 80, rgb: [240, 240, 240] },
    { rows: 259, rgb: [200, 30, 40] },
    { rows: 60, rgb: [240, 240, 240] },
    { rows: 1, rgb: randomColour() }, // unique file per run
  ]);
  const response = await request.post("/api/items", {
    multipart: { file: { name: "swatch.png", mimeType: "image/png", buffer: png }, type: "fabric" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id;
}

// Deep analysis is owner-only (it spends the owner's Anthropic credit).
test.use({ asOwner: true });

test("deep analysis asks first, runs in the background and shows a labelled result", async ({ page, request }) => {
  test.setTimeout(90_000);
  const status = await (await request.get("/api/deep-analysis/status")).json();
  expect(
    status.provider,
    "The e2e API (scripts/e2e_server.py) always uses the fake analyzer.",
  ).toBe("fake");

  const id = await uploadVia(request);
  try {
    await page.goto(`/items/${id}`);
    const panel = page.getByRole("region", { name: "Deep analysis" });
    await expect(panel.getByText(/nothing leaves this computer/)).toBeVisible();

    // Cancelling sends nothing.
    await panel.getByRole("button", { name: "Deep analyze" }).click();
    const dialog = panel.getByRole("alertdialog", { name: "Run the test analyzer?" });
    await expect(dialog).toContainText("2576 px");
    await expect(dialog).toContainText("Never sent: your notes, the source url");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect((await (await request.get(`/api/items/${id}/deep-analysis`)).json()).status).toBe("not_run");

    // Confirming starts a background run; the page polls until it completes.
    await panel.getByRole("button", { name: "Deep analyze" }).click();
    await panel.getByRole("button", { name: "Run test analysis" }).click();
    await expect(panel.getByRole("status")).toContainText("Analysing with local-fake-analyzer");
    const result = panel.getByRole("article", { name: "Analysis" });
    await expect(result).toContainText("Test description from the local fake analyzer", { timeout: 30_000 });
    await expect(result).toContainText("It may be wrong");
    await expect(panel.getByRole("button", { name: "Run again" })).toBeEnabled();

    const stored = await (await request.get(`/api/items/${id}/deep-analysis`)).json();
    expect(stored.status).toBe("completed");
    expect(stored.result_model).toBe("local-fake-analyzer");

    // The result survives a reload; the rest of the page is unaffected.
    await page.reload();
    await expect(panel.getByRole("article", { name: "Analysis" })).toContainText("Test description");
    await expect(page.getByRole("region", { name: "Tags" }).getByRole("heading", { name: "Tags" })).toBeVisible();
  } finally {
    await request.delete(`/api/items/${id}`);
  }
});
