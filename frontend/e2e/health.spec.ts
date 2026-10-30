import { expect, test } from "./helpers/auth";

test("landing page renders and links into the app", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Thread" })).toBeVisible(); // the wordmark
  await expect(page.getByText("Everything you wear leaves a trace.").first()).toBeVisible();
  await page.getByRole("link", { name: "Enter the archive" }).click();
  await expect(page).toHaveURL(/\/gallery$/);
  await page.getByRole("navigation", { name: "More" }).getByRole("link", { name: "System" }).click();
  await expect(page).toHaveURL(/\/settings$/);
});

test.describe("signed out", () => {
  test.use({ signedIn: false });

  test("the landing page invites a visitor to begin an archive", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Thread" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Begin your archive" })).toHaveAttribute("href", "/signup");
    await expect(page.getByRole("link", { name: "See the showcase" })).toHaveAttribute("href", "/showcase");
    // Signed out, the header offers the public showcase, not an archive.
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Archive" })).toHaveCount(0);
    await nav.getByRole("link", { name: "Showcase" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Showcase" })).toBeVisible();
    await page.goto("/gallery");
    await expect(page.getByText("Sign in to see your archive")).toBeVisible();
  });
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
