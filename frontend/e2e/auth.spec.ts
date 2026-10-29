import { emailLink, expect, PASSWORD, signIn, signUpVerified, test, uniqueEmail } from "./helpers/auth";
import { randomColour, solidPng } from "./helpers/png";

// Accounts through the real pages: sign-up, the emailed links (read from the e2e API's local
// outbox), sign-in and out, password reset, isolation between accounts, and deletion.

test.describe("signed out", () => {
  test.use({ signedIn: false });

  test("sign up, confirm the email, sign in, upload, sign out", async ({ page, request }) => {
    const email = uniqueEmail("signup");
    await page.goto("/signup");
    await page.getByLabel("Your name").fill("Meera Iyer");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Check your email")).toBeVisible();

    const link = await emailLink(request, email, "verify-email");
    await page.goto(link.pathname + link.search);
    await expect(page.getByText("Your email is confirmed")).toBeVisible();

    await page.goto("/login?next=/upload");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/upload$/);
    await expect(page.getByRole("link", { name: "Your account: Meera" })).toBeVisible();

    await page.getByTestId("file-input").setInputFiles({ name: "swatch.png", mimeType: "image/png", buffer: solidPng(200, 260, randomColour()) });
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/gallery");
    await expect(page.getByText("Sign in to see your archive")).toBeVisible();

    await signIn(request, email);
    expect((await request.post("/api/auth/delete-account", { data: { password: PASSWORD } })).status()).toBe(204);
  });

  test("a wrong password is refused without saying whether the account exists", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(uniqueEmail("nobody"));
    await page.getByLabel("Password").fill("not a real password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("form", { name: "Sign in" }).getByRole("alert")).toHaveText("Email or password is incorrect.");
  });

  test("forgot password: the emailed link sets a new one", async ({ page, request }) => {
    const email = uniqueEmail("reset");
    await signUpVerified(request, email);

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Email me a link" }).click();
    await expect(page.getByText("Check your email")).toBeVisible();

    const link = await emailLink(request, email, "reset-password");
    const fresh = "a fresh e2e passphrase";
    await page.goto(link.pathname + link.search);
    await page.getByLabel("New password", { exact: true }).fill(fresh);
    await page.getByLabel("New password, again").fill(fresh);
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(page.getByText("Your password is changed")).toBeVisible();

    expect((await request.post("/api/auth/login", { data: { email, password: PASSWORD } })).status()).toBe(401);
    await signIn(request, email, fresh);
    expect((await request.post("/api/auth/delete-account", { data: { password: fresh } })).status()).toBe(204);
  });
});

test("one account's pieces are invisible to another", async ({ page, request, browser, baseURL }) => {
  const upload = await request.post("/api/items", {
    multipart: { file: { name: "mine.png", mimeType: "image/png", buffer: solidPng(220, 300, randomColour()) }, type: "fabric" },
  });
  expect(upload.status()).toBe(201);
  const pieceId = (await upload.json()).id;
  await page.goto(`/items/${pieceId}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const other = await browser.newContext({ baseURL });
  try {
    const email = uniqueEmail("other");
    await signUpVerified(other.request, email);
    await signIn(other.request, email);
    const theirs = await other.newPage();
    await theirs.goto(`/items/${pieceId}`);
    await expect(theirs.getByText("This item doesn't exist")).toBeVisible();
    await theirs.goto("/gallery");
    await expect(theirs.getByText("Your library is empty")).toBeVisible();
    expect((await other.request.get(`/api/items/${pieceId}/image`)).status()).toBe(404);
    expect((await other.request.delete(`/api/items/${pieceId}`)).status()).toBe(404);
    await other.request.post("/api/auth/delete-account", { data: { password: PASSWORD } });
  } finally {
    await other.close();
  }
  expect((await request.get(`/api/items/${pieceId}`)).status()).toBe(200);
});

test("deleting an account from the account page removes it", async ({ page, request }) => {
  const me = await (await request.get("/api/auth/me")).json();
  await page.goto("/account");
  await expect(page.getByRole("definition").filter({ hasText: me.email })).toBeVisible();

  await page.getByRole("button", { name: "Delete my account…" }).click();
  await page.getByLabel("Your password").fill(PASSWORD);
  await page.getByLabel('Type "delete" to confirm').fill("delete");
  await page.getByRole("button", { name: "Delete everything" }).click();
  await expect(page).toHaveURL(/\/\?deleted=1$/);

  expect((await request.get("/api/auth/me")).status()).toBe(401);
  expect((await request.post("/api/auth/login", { data: { email: me.email, password: PASSWORD } })).status()).toBe(401);
});
