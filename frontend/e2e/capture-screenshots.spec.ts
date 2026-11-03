import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { APIRequestContext, Page } from "@playwright/test";

import { expect, PASSWORD, signIn, signUpVerified, test, uniqueEmail } from "./helpers/auth";

// Real product screenshots for the landing page. Skipped unless THREAD_CAPTURE=1:
//
//   THREAD_CAPTURE=1 npx playwright test e2e/capture-screenshots.spec.ts --project=desktop
//
// It runs against the end-to-end servers (throwaway database), signs up a fresh account,
// uploads the demo's public-domain images through the normal upload API, records the same
// catalogue tags the demo shows, builds a collection and an outfit, and photographs the real
// pages. The account and everything it uploaded are deleted afterwards. Nothing is staged
// or retouched: the PNGs in .cache/screens are what the app rendered (optimised separately).

const OUT = path.resolve(__dirname, "../.cache/screens");
const DEMO_DIR = path.resolve(__dirname, "../public/demo");

type DemoPiece = { id: string; title: string; type: string; image: string; tags: { category: string; tag: string; source: string }[] };
type Demo = { pieces: DemoPiece[] };

const PIECES = [
  "bandhani-sari",
  "kashmir-shawl-boteh",
  "ikat-striped-panel",
  "bandhani-odhani",
  "wool-jacket-1855",
  "wool-shawl-1800s",
  "gold-block-print",
  "resist-dyed-cotton",
  "kashmir-shawl-border",
  "silk-slippers-1865",
  "wool-dress-1896",
  "leather-boots-1780",
];

test.skip(process.env.THREAD_CAPTURE !== "1", "captures screenshots only when THREAD_CAPTURE=1");
test.use({ signedIn: false, viewport: { width: 1440, height: 900 } });

async function upload(request: APIRequestContext, piece: DemoPiece): Promise<string> {
  const buffer = await readFile(path.join(DEMO_DIR, piece.image));
  const response = await request.post("/api/items", {
    multipart: { file: { name: `${piece.id}.webp`, mimeType: "image/webp", buffer }, type: piece.type },
  });
  expect(response.status(), await response.text()).toBe(201);
  const id: string = (await response.json()).id;
  expect((await request.patch(`/api/items/${id}`, { data: { notes: piece.title } })).status()).toBe(200);
  const recorded = piece.tags.filter((t) => t.source === "recorded").map(({ category, tag }) => ({ category, tag }));
  if (recorded.length) {
    expect((await request.patch(`/api/items/${id}/tags`, { data: { add: recorded, remove: [] } })).status()).toBe(200);
  }
  await expect
    .poll(async () => (await (await request.get(`/api/items/${id}`)).json()).palette?.colors?.length ?? 0, { timeout: 60_000 })
    .toBeGreaterThan(0);
  return id;
}

/** Every image on the page has finished loading, and fonts are in. */
async function settled(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((img) => (img.complete ? null : new Promise((done) => img.addEventListener("load", done, { once: true })))),
    );
  });
}

test("capture real product screenshots", async ({ page, request }) => {
  test.setTimeout(600_000);
  await mkdir(OUT, { recursive: true });
  const email = uniqueEmail("capture");
  await signUpVerified(request, email, "Thread demo");
  await signIn(request, email);
  try {
    const demo: Demo = JSON.parse(await readFile(path.join(DEMO_DIR, "demo.json"), "utf8"));
    const byId = new Map(demo.pieces.map((p) => [p.id, p]));
    const ids = new Map<string, string>();
    // Oldest first, so the gallery (newest first) opens on the textiles.
    for (const key of [...PIECES].reverse()) ids.set(key, await upload(request, byId.get(key)!));
    const id = (key: string) => ids.get(key)!;

    const collection = await (await request.post("/api/collections", { data: { name: "Indian textiles" } })).json();
    for (const key of ["bandhani-sari", "bandhani-odhani", "ikat-striped-panel", "kashmir-shawl-boteh", "kashmir-shawl-border", "gold-block-print", "resist-dyed-cotton"]) {
      expect((await request.post(`/api/collections/${collection.id}/items`, { data: { item_id: id(key) } })).status()).toBeLessThan(300);
    }
    const outfit = await (await request.post("/api/outfits", { data: { name: "Red shawl, dark coat" } })).json();
    const items = ["wool-shawl-1800s", "wool-jacket-1855", "silk-slippers-1865"].map((key) => ({ item_id: id(key) }));
    expect((await request.put(`/api/outfits/${outfit.id}/items`, { data: { items } })).status()).toBe(200);

    // 1. The archive.
    await page.goto("/gallery");
    await expect(page.locator(`a[href="/items/${id("bandhani-sari")}"]`).first()).toBeVisible();
    await settled(page);
    await page.screenshot({ path: `${OUT}/gallery.png` });

    // 2. A piece with its measured palette, and 3. its similar pieces.
    await page.goto(`/items/${id("bandhani-sari")}`);
    const similar = page.getByRole("region", { name: "Similar pieces" });
    await expect(similar.locator('a[href^="/items/"]').first()).toBeVisible({ timeout: 180_000 });
    await settled(page);
    await page.screenshot({ path: `${OUT}/palette.png` });
    await similar.scrollIntoViewIfNeeded();
    await settled(page);
    await similar.screenshot({ path: `${OUT}/similar.png` });

    // 4. A textile record: weave and craft recorded by a person, beside the palette.
    await page.goto(`/items/${id("kashmir-shawl-boteh")}`);
    const tags = page.getByRole("region", { name: "Tags", exact: true });
    await expect(tags.getByText("twill")).toBeVisible();
    await tags.scrollIntoViewIfNeeded();
    await settled(page);
    await tags.screenshot({ path: `${OUT}/textile-record.png` });

    // 5. A collection.
    await page.goto(`/collections/${collection.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Indian textiles" })).toBeVisible();
    await settled(page);
    await page.screenshot({ path: `${OUT}/collection.png` });

    // 6. The Outfit Studio.
    await page.goto(`/outfit-studio/${outfit.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Red shawl, dark coat" })).toBeVisible();
    await settled(page);
    await page.screenshot({ path: `${OUT}/outfit-studio.png` });
  } finally {
    await request.post("/api/auth/delete-account", { data: { password: PASSWORD } });
  }
});
