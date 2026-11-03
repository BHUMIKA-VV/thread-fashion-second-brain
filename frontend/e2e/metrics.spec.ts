import { expect, test } from "./helpers/auth";

// Visit counts end to end: a public page sends one cookieless count per visit, tagged by the
// link's ?ref=, a browser that asks not to be tracked sends none, and only the owner sees the
// totals, beside the funnel from the app's own tables.

// An ordinary browser: the API ignores user agents that look automated, like HeadlessChrome.
const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

test.describe("the owner", () => {
  test.use({ asOwner: true });

  test("sees a tagged visit counted once, and nothing from a visitor who opted out", async ({ page, browser, baseURL }, testInfo) => {
    const tag = `e2e-${testInfo.project.name}-${Date.now().toString(36)}`;
    const quiet = `${tag}-gpc`;

    const visitor = await browser.newContext({ baseURL, userAgent: BROWSER });
    const tab = await visitor.newPage();
    const counted = tab.waitForRequest((r) => r.url().endsWith("/api/metrics/view") && r.method() === "POST");
    await tab.goto(`/demo?ref=${tag}`);
    expect((await counted).postDataJSON()).toMatchObject({ event: "demo_view", ref: tag });
    // Moving between demo pages in the same visit doesn't count the demo again.
    const views: string[] = [];
    tab.on("request", (r) => r.url().endsWith("/api/metrics/view") && views.push(r.url()));
    await tab.getByRole("list", { name: "Demo pieces" }).getByRole("link").first().click();
    await expect(tab).toHaveURL(/\/demo\/pieces\//);
    await tab.waitForLoadState("networkidle");
    expect(views).toEqual([]);
    await visitor.close();

    const privateVisitor = await browser.newContext({ baseURL, userAgent: BROWSER, extraHTTPHeaders: { "Sec-GPC": "1" } });
    const privateTab = await privateVisitor.newPage();
    await privateTab.addInitScript(() => Object.defineProperty(navigator, "globalPrivacyControl", { value: true }));
    const sent: string[] = [];
    privateTab.on("request", (r) => r.url().endsWith("/api/metrics/view") && sent.push(r.url()));
    await privateTab.goto(`/demo?ref=${quiet}`);
    await privateTab.waitForLoadState("networkidle");
    expect(sent).toEqual([]);
    await privateVisitor.close();

    await page.goto("/accounts");
    const visits = page.getByRole("region", { name: "Visits" });
    await expect(visits.getByText(/daily totals, not people/)).toBeVisible();
    const row = visits.getByRole("row", { name: new RegExp(`Link tagged “${tag}”`) });
    await expect(row.getByRole("cell").first()).toHaveText("1");
    await expect(visits.getByRole("rowheader", { name: new RegExp(quiet) })).toHaveCount(0);
    await expect(visits.getByLabel("Outcomes").getByText("Accounts created")).toBeVisible();
  });
});

test.describe("a visitor", () => {
  test.use({ signedIn: false });

  test("cannot read the totals, and another site cannot post a count", async ({ request }) => {
    expect((await request.get("/api/admin/metrics")).status()).toBe(401);
    const crossSite = await request.post("/api/metrics/view", {
      data: { event: "landing_view" },
      headers: { Origin: "https://evil.example" },
    });
    expect(crossSite.status()).toBe(403);
  });
});
