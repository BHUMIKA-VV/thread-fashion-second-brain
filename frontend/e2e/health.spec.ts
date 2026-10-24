import { expect, test } from "@playwright/test";

test("landing page renders and links into the app", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("remembered");
  await page.getByRole("link", { name: "Start uploading" }).click();
  await expect(page).toHaveURL(/\/upload$/);
  await page.getByRole("link", { name: "System" }).click();
  await expect(page).toHaveURL(/\/settings$/);
});

test("system page shows the live API and database through the proxy", async ({ page }) => {
  await page.goto("/settings");

  const status = page.getByRole("region", { name: "System status" });
  await expect(status.getByText("Online")).toBeVisible();
  await expect(status.getByText("Connected")).toBeVisible();
  await expect(status.getByText("Available")).toBeVisible();
  await expect(status.getByText("Up to date")).toBeVisible();
});

test("the /api proxy reaches FastAPI", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    status: "ok",
    database: { status: "ok", schema_up_to_date: true },
  });
});
