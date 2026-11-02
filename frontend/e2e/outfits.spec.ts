import type { APIRequestContext } from "@playwright/test";

import { expect, signIn, signUpVerified, test, uniqueEmail } from "./helpers/auth";
import { bandsPng, randomColour } from "./helpers/png";

type Rgb = [number, number, number];

async function uploadVia(request: APIRequestContext, colour: Rgb, notes: string): Promise<string> {
  const png = bandsPng(300, [
    { rows: 299, rgb: colour },
    { rows: 1, rgb: randomColour() }, // unique file per run
  ]);
  const response = await request.post("/api/items", {
    multipart: { file: { name: "swatch.png", mimeType: "image/png", buffer: png }, type: "fabric" },
  });
  expect(response.status()).toBe(201);
  const id: string = (await response.json()).id;
  expect((await request.patch(`/api/items/${id}`, { data: { notes } })).status()).toBe(200);
  return id;
}

async function makeOutfit(request: APIRequestContext, name: string, itemIds: string[]): Promise<string> {
  const outfit = await (await request.post("/api/outfits", { data: { name } })).json();
  const items = itemIds.map((item_id) => ({ item_id }));
  expect((await request.put(`/api/outfits/${outfit.id}/items`, { data: { items } })).status()).toBe(200);
  return outfit.id;
}

test("compose an outfit: add, reorder by keyboard, set a role, describe, duplicate, export, delete", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const red = await uploadVia(request, [200, 30, 40], "Red stole");
  const teal = await uploadVia(request, [20, 150, 150], "Teal kurta");

  await page.goto("/outfit-studio");
  await page.getByLabel("Name").fill("Sangeet evening");
  await page.getByRole("button", { name: "Start an outfit" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sangeet evening" })).toBeVisible();

  await page.getByRole("button", { name: "Add Red stole" }).click();
  await expect(page.getByRole("button", { name: "Remove Red stole" })).toBeVisible();
  await page.getByRole("button", { name: "Add Teal kurta" }).click();
  await expect(page.getByRole("button", { name: "Remove Teal kurta" })).toBeVisible();

  // Real palettes drive the relationships: red and teal are opposite hues on different pieces.
  await expect(page.getByRole("heading", { name: "Colour relationships" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Complementary" })).toBeVisible();
  await expect(page.getByText("No opposite hues across pieces.")).toBeHidden();

  // Reorder from the keyboard, with focus staying on the control.
  const later = page.getByRole("button", { name: "Move Red stole later" });
  await later.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Red stole moved to position 2 of 2.")).toBeAttached();
  const order = page.getByRole("list", { name: /Pieces in this outfit/ }).getByRole("listitem");
  await expect(order.first()).toContainText("Teal kurta");
  await expect(later).toBeFocused();

  await page.getByLabel("Role of Red stole").selectOption("inspiration");
  await expect(page.getByTestId("outfit-composition").getByText("Inspiration")).toBeVisible();

  await page.getByRole("radio", { name: "Column" }).check({ force: true });
  await page.getByLabel("Occasion").fill("Sangeet");
  await page.getByLabel("Season").selectOption("winter");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Occasion")).toHaveValue("Sangeet");
  await expect(page.getByRole("radio", { name: "Column" })).toBeChecked();
  await expect(order.first()).toContainText("Teal kurta");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PNG" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("thread-outfit-sangeet-evening.png");
  const path = await download.path();
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(path);
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  expect(bytes.readUInt32BE(16)).toBe(1080);
  await expect(page.getByText("Card downloaded.")).toBeVisible();

  await page.getByRole("button", { name: "Duplicate" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Sangeet evening.*copy/i })).toBeVisible();

  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Yes, delete outfit" }).click();
  await expect(page).toHaveURL(/\/outfit-studio$/);
  await expect(page.getByRole("link", { name: /Sangeet evening/ })).toHaveCount(1);
  // Deleting an outfit leaves its pieces in the library.
  expect((await request.get(`/api/items/${red}`)).status()).toBe(200);
  expect((await request.get(`/api/items/${teal}`)).status()).toBe(200);
});

test("dragging a photograph reorders the pieces", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "dragging is a pointer shortcut; phones use the buttons");
  const red = await uploadVia(request, [200, 30, 40], "Red stole");
  const teal = await uploadVia(request, [20, 150, 150], "Teal kurta");
  const id = await makeOutfit(request, "Dragged", [red, teal]);
  await page.goto(`/outfit-studio/${id}`);
  const composition = page.getByTestId("outfit-composition");
  await composition.getByRole("img", { name: "Red stole" }).dragTo(composition.getByRole("img", { name: "Teal kurta" }));
  const order = page.getByRole("list", { name: /Pieces in this outfit/ }).getByRole("listitem");
  await expect(order.first()).toContainText("Teal kurta");
  await page.reload();
  await expect(order.first()).toContainText("Teal kurta");
});

test("the whole studio works from the keyboard, with focus never lost", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "keyboard navigation is a desktop concern");
  test.setTimeout(90_000);
  const red = await uploadVia(request, [200, 30, 40], "Red stole");
  await uploadVia(request, [20, 150, 150], "Teal kurta");
  await uploadVia(request, [240, 200, 60], "Yellow dupatta");
  const id = await makeOutfit(request, "By keyboard", [red]);
  await page.goto(`/outfit-studio/${id}`);
  await page.waitForLoadState("networkidle");

  const focusedInMain = () => page.evaluate(() => !!document.activeElement?.closest("main"));
  const order = page.getByRole("list", { name: /Pieces in this outfit/ }).getByRole("listitem");

  // Add: the button stays focused, and now says the piece is in the outfit.
  await page.getByRole("button", { name: "Add Teal kurta" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Teal kurta, in this outfit" })).toBeFocused();
  await expect(page.getByText("Teal kurta added. 2 of 12 pieces.")).toBeAttached();

  // Move, by both ends: pressing at the end changes nothing and keeps focus.
  await page.getByRole("button", { name: "Move Red stole earlier" }).focus();
  await page.keyboard.press("Enter");
  await expect(order.first()).toContainText("Red stole");
  await expect(page.getByRole("button", { name: "Move Red stole earlier" })).toBeFocused();
  await page.getByRole("button", { name: "Move Red stole later" }).focus();
  await page.keyboard.press("Space");
  await expect(order.first()).toContainText("Teal kurta");
  await expect(page.getByRole("button", { name: "Move Red stole later" })).toBeFocused();

  // Role, with arrow keys in the native select.
  await page.getByLabel("Role of Red stole").focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("outfit-composition").getByText("Accessory")).toBeVisible();

  // Layout, with arrow keys in the radio group, and a visible outline on the chosen label.
  await page.getByRole("radio", { name: "Feature" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Grid" })).toBeChecked();
  const labelOutline = await page.evaluate(() => getComputedStyle(document.activeElement!.closest("label")!).outlineStyle);
  expect(labelOutline).not.toBe("none");

  // Replace: focus lands on the new piece's Replace button.
  await page.getByRole("button", { name: "Replace Teal kurta" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Use Yellow dupatta" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Replace Yellow dupatta" })).toBeFocused();
  await expect(order.first()).toContainText("Yellow dupatta");

  // Remove: focus goes to the neighbour, then the heading.
  await page.getByRole("button", { name: "Remove Yellow dupatta" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Remove Red stole" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Composition" })).toBeFocused();
  expect(await focusedInMain()).toBe(true);

  // Delete confirmation opens on the safe choice, and cancelling returns to Delete.
  await page.getByRole("button", { name: "Delete" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Keep it" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Delete" })).toBeFocused();
});

test("every Tab stop in the studio is visible and outlined, with no trap", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "keyboard navigation is a desktop concern");
  const red = await uploadVia(request, [200, 30, 40], "Red stole");
  const id = await makeOutfit(request, "Tab stops", [red]);
  await page.goto(`/outfit-studio/${id}`);
  await page.waitForLoadState("networkidle");
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      // A visually hidden radio shows its focus on the label around it.
      const shown = el.matches("input.sr-only") ? el.closest("label")! : el;
      const style = getComputedStyle(shown);
      const box = shown.getBoundingClientRect();
      return {
        name: `${el.tagName} ${el.getAttribute("aria-label") ?? el.textContent ?? ""}`.slice(0, 50),
        outlined: (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none",
        visible: box.width > 0 && box.height > 0,
      };
    });
    if (!stop) continue;
    expect(stop.visible, stop.name).toBe(true);
    expect(stop.outlined, stop.name).toBe(true);
    seen.add(stop.name);
  }
  expect(seen.size).toBeGreaterThan(12);
});

test("rapid additions, moves and removals all land, in order, and match the server", async ({ page, request }) => {
  test.setTimeout(90_000);
  const names = ["Alpha", "Beta", "Gamma", "Delta"];
  const ids: string[] = [];
  for (const [i, name] of names.entries()) ids.push(await uploadVia(request, [40 + i * 50, 80, 200 - i * 40], `${name} piece`));
  const id = await makeOutfit(request, "Rapid", []);
  await page.goto(`/outfit-studio/${id}`);
  await page.waitForLoadState("networkidle");

  // Slow every save, so the next clicks arrive while earlier ones are still in flight.
  const seen: string[][] = [];
  await page.route(`**/api/outfits/${id}/items`, async (route) => {
    seen.push((route.request().postDataJSON() as { items: { item_id: string }[] }).items.map((i) => i.item_id));
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  const click = (name: string) => page.getByRole("button", { name }).click();
  for (const name of names) await click(`Add ${name} piece`);
  await click("Move Delta piece earlier");
  await click("Remove Alpha piece");
  await click("Move Beta piece later");

  // Alpha Beta Gamma Delta -> Alpha Beta Delta Gamma -> Beta Delta Gamma -> Delta Beta Gamma
  const expected = [ids[3], ids[1], ids[2]];
  const order = page.getByRole("list", { name: /Pieces in this outfit/ }).getByRole("listitem");
  await expect(order).toHaveCount(3);
  await expect.poll(() => seen.length, { timeout: 15_000 }).toBe(7);
  expect(seen[0]).toEqual([ids[0]]);
  expect(seen[6]).toEqual(expected);
  await expect
    .poll(async () => {
      const outfit = await (await request.get(`/api/outfits/${id}`)).json();
      return outfit.pieces.map((p: { item: { id: string } }) => p.item.id);
    })
    .toEqual(expected);
  await expect(order.nth(0)).toContainText("Delta");
  await expect(order.nth(1)).toContainText("Beta");
  await expect(order.nth(2)).toContainText("Gamma");
  await page.reload();
  await expect(order.nth(0)).toContainText("Delta");
  await expect(order).toHaveCount(3);
});

test("a save the server refuses, or a dropped connection, shows an error and the saved state", async ({ page, request }) => {
  const red = await uploadVia(request, [200, 30, 40], "Red stole");
  const teal = await uploadVia(request, [20, 150, 150], "Teal kurta");
  const id = await makeOutfit(request, "Refused", [red, teal]);
  await page.goto(`/outfit-studio/${id}`);
  const order = page.getByRole("list", { name: /Pieces in this outfit/ }).getByRole("listitem");
  await expect(order.first()).toContainText("Red stole");

  await page.route(`**/api/outfits/${id}/items`, (route) => route.abort());
  await page.getByRole("button", { name: "Move Red stole later" }).click();
  await expect(page.getByText(/back to its last saved state/)).toBeVisible();
  await expect(order.first()).toContainText("Red stole");

  await page.unroute(`**/api/outfits/${id}/items`);
  await page.route(`**/api/outfits/${id}/items`, (route) =>
    route.fulfill({
      status: 422,
      json: { error: { code: "outfit_too_large", message: "An outfit can hold up to 12 pieces." } },
    }),
  );
  await page.getByRole("button", { name: "Remove Teal kurta" }).click();
  await expect(page.getByText(/back to its last saved state/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Teal kurta" })).toBeVisible();

  // The server was never changed, and the studio recovers when saving works again.
  await page.unroute(`**/api/outfits/${id}/items`);
  const saved = await (await request.get(`/api/outfits/${id}`)).json();
  expect(saved.pieces.map((p: { item: { id: string } }) => p.item.id)).toEqual([red, teal]);
  await page.getByRole("button", { name: "Move Red stole later" }).click();
  await expect(order.first()).toContainText("Teal kurta");
  await expect(page.getByText(/back to its last saved state/)).toBeHidden();
});

test("the 12-piece limit holds in the studio and at the API, without changing the outfit", async ({ page, request }) => {
  test.setTimeout(120_000);
  const ids: string[] = [];
  for (let i = 0; i < 13; i++) ids.push(await uploadVia(request, [20 + i * 15, 90, 220 - i * 15], `Piece ${String.fromCharCode(65 + i)}`));
  const id = await makeOutfit(request, "Full", ids.slice(0, 12));

  const over = await request.put(`/api/outfits/${id}/items`, { data: { items: ids.map((item_id) => ({ item_id })) } });
  expect(over.status()).toBe(422);
  const kept = await (await request.get(`/api/outfits/${id}`)).json();
  expect(kept.pieces).toHaveLength(12);

  await page.goto(`/outfit-studio/${id}`);
  const extra = page.getByRole("button", { name: "Add Piece M" });
  await expect(extra).toHaveAttribute("aria-disabled", "true");
  await extra.dispatchEvent("click"); // Playwright refuses a real click on aria-disabled
  await expect(page.getByRole("button", { name: "Remove Piece M" })).toHaveCount(0);
  await expect(page.getByText("12 of 12 pieces.", { exact: false })).toBeVisible();
});

test("a failed photograph leaves a blank tile and is reported", async ({ page, request }) => {
  const red = await uploadVia(request, [200, 30, 40], "Red stole");
  const teal = await uploadVia(request, [20, 150, 150], "Teal kurta");
  const id = await makeOutfit(request, "Partly broken", [red, teal]);
  // Blocked from the start, so no copy of the photograph is in the browser's image cache.
  await page.route(new RegExp(`/api/items/${teal}/`), (route) => route.abort());
  await page.goto(`/outfit-studio/${id}`);
  await expect(page.getByRole("button", { name: "Remove Teal kurta" })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PNG" }).click();
  await downloadPromise;
  await expect(page.getByText(/1 photograph could not be loaded/)).toBeVisible();
});

test("deleting a source piece keeps the outfit and its other pieces", async ({ page, request }) => {
  const red = await uploadVia(request, [200, 30, 40], "Red stole");
  const teal = await uploadVia(request, [20, 150, 150], "Teal kurta");
  const id = await makeOutfit(request, "Survivor", [red, teal]);
  expect((await request.delete(`/api/items/${teal}`)).status()).toBe(204);

  await page.goto(`/outfit-studio/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Survivor" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Red stole" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Teal kurta" })).toHaveCount(0);
});

test("an outfit joins a collection, and appears there", async ({ page, request }) => {
  const red = await uploadVia(request, [200, 30, 40], "Red stole");
  const id = await makeOutfit(request, "Collected look", [red]);
  const name = `Wedding ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const collection = await (await request.post("/api/collections", { data: { name } })).json();

  await page.goto(`/outfit-studio/${id}`);
  const box = page.getByRole("checkbox", { name });
  await box.check();
  await expect(box).toBeChecked();

  await page.goto(`/collections/${collection.id}`);
  const list = page.getByRole("list", { name: "Outfits in this collection" });
  await expect(list.getByRole("link", { name: /Collected look/ })).toBeVisible();
  await page.getByRole("button", { name: "Remove Collected look from this collection" }).click();
  await expect(page.getByRole("heading", { name: "Outfits" })).toHaveCount(0);
  // The outfit itself is untouched.
  expect((await request.get(`/api/outfits/${id}`)).status()).toBe(200);
});

test("another account can't see, change or use anything of yours", async ({ page, request, browser, baseURL }) => {
  const red = await uploadVia(request, [200, 30, 40], "Red stole");
  const id = await makeOutfit(request, "Private look", [red]);

  const other = await browser.newContext({ baseURL });
  try {
    const email = uniqueEmail("outfit-stranger");
    await signUpVerified(other.request, email);
    await signIn(other.request, email);

    expect((await other.request.get(`/api/outfits/${id}`)).status()).toBe(404);
    expect((await other.request.patch(`/api/outfits/${id}`, { data: { name: "Mine" } })).status()).toBe(404);
    expect((await other.request.delete(`/api/outfits/${id}`)).status()).toBe(404);
    expect((await other.request.post(`/api/outfits/${id}/duplicate`)).status()).toBe(404);
    expect(((await (await other.request.get("/api/outfits")).json()) as { total: number }).total).toBe(0);

    const theirs = await (await other.request.post("/api/outfits", { data: { name: "Theirs" } })).json();
    const stolen = await other.request.put(`/api/outfits/${theirs.id}/items`, { data: { items: [{ item_id: red }] } });
    expect(stolen.status()).toBe(404);

    const otherPage = await other.newPage();
    await otherPage.goto(`/outfit-studio/${id}`);
    await expect(otherPage.getByText("This outfit doesn't exist")).toBeVisible();
    await otherPage.close();
    await other.request.delete(`/api/outfits/${theirs.id}`);
  } finally {
    await other.close();
  }
  await page.goto(`/outfit-studio/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Private look" })).toBeVisible();
});

test("outfits never reach the public showcase", async ({ request }) => {
  const red = await uploadVia(request, [200, 30, 40], "Red stole");
  const name = `Secret outfit ${Date.now()}`;
  await makeOutfit(request, name, [red]);
  for (const path of ["/api/showcase", "/api/showcase/items?limit=100", "/api/showcase/collections"]) {
    expect(await (await request.get(path)).text(), path).not.toContain(name);
  }
});

test("a five-piece feature composition has no gap, on screen and in the same order", async ({ page, request }) => {
  const ids: string[] = [];
  for (const [i, name] of ["One", "Two", "Three", "Four", "Five"].entries()) {
    ids.push(await uploadVia(request, [40 + i * 40, 90, 200 - i * 30], name));
  }
  const id = await makeOutfit(request, "No gap", ids);
  await page.goto(`/outfit-studio/${id}`);
  const composition = page.getByTestId("outfit-composition");
  await expect(composition.locator("figure")).toHaveCount(5);
  const whole = (await composition.boundingBox())!;
  const last = (await composition.locator("figure").last().boundingBox())!;
  const fourth = (await composition.locator("figure").nth(3).boundingBox())!;
  expect(Math.abs(last.x + last.width - (whole.x + whole.width))).toBeLessThan(1);
  expect(Math.abs(fourth.y - last.y)).toBeLessThan(1);
  expect(Math.abs(fourth.height - last.height)).toBeLessThan(1);
  expect(fourth.width).toBeGreaterThan(last.width);
});

test("the reorder hint only offers dragging where dragging works", async ({ page, request }, testInfo) => {
  const red = await uploadVia(request, [200, 30, 40], "Red stole");
  const id = await makeOutfit(request, "Hint", [red]);
  await page.goto(`/outfit-studio/${id}`);
  const drag = page.getByText("Drag photographs to reorder, or use the arrows.");
  const arrows = page.getByText("Use the arrows to reorder.");
  if (testInfo.project.name === "mobile") {
    await expect(arrows).toBeVisible();
    await expect(drag).toBeHidden();
  } else {
    await expect(drag).toBeVisible();
    await expect(arrows).toBeHidden();
  }
});

test("the phone header keeps the sections on one line and every control reachable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "this is about phone widths");
  await page.goto("/outfit-studio");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Studio" })).toBeVisible();
  for (const width of [360, 390, 412]) {
    await page.setViewportSize({ width, height: 800 });
    const tops = await nav.getByRole("link").evaluateAll((links) => links.map((l) => l.getBoundingClientRect().top));
    expect(new Set(tops).size, `${width}px`).toBe(1);
    const logo = (await page.getByRole("link", { name: "Thread, home" }).boundingBox())!;
    const signOut = (await page.getByRole("button", { name: "Sign out" }).boundingBox())!;
    expect(Math.abs(logo.y + logo.height / 2 - (signOut.y + signOut.height / 2)), `${width}px`).toBeLessThan(8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px`).toBeLessThanOrEqual(0);
  }
  // The narrowest common width may wrap, but must not scroll sideways or hide a section.
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await expect(nav.getByRole("link")).toHaveCount(5);
});

test("a full composition with long piece names stays inside a phone screen", async ({ page, request }) => {
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    ids.push(await uploadVia(request, [40 + i * 40, 90, 200 - i * 30], `Synthetic sample swatch number ${i + 1} with a long descriptive name`));
  }
  const id = await makeOutfit(request, "Long names", ids);
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/outfit-studio/${id}`);
    const composition = page.getByTestId("outfit-composition");
    await expect(composition.locator("figure")).toHaveCount(5);
    await page.waitForLoadState("networkidle");
    const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: document.documentElement.clientWidth }));
    expect(widths.page, `${width}px`).toBeLessThanOrEqual(widths.screen);
    const box = (await composition.boundingBox())!;
    expect(box.x + box.width, `${width}px`).toBeLessThanOrEqual(widths.screen);
  }
});

test("the studio fits a phone without sideways scrolling", async ({ page, request }) => {
  const red = await uploadVia(request, [200, 30, 40], "Red stole");
  const id = await makeOutfit(request, "A very long outfit name that has to wrap on small screens", [red]);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/outfit-studio", `/outfit-studio/${id}`]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    // Not innerWidth: on a phone it grows with the content, which hides the overflow.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
