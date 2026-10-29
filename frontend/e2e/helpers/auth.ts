import { test as base, expect, type APIRequestContext } from "@playwright/test";

/**
 * Every test runs signed in as an account of its own on the end-to-end database (see
 * backend/scripts/e2e_server.py): signed up, verified through the local outbox, signed in,
 * and deleted afterwards with everything it uploaded. `test.use({ asOwner: true })` signs in
 * as the owner account instead; `test.use({ signedIn: false })` starts signed out.
 *
 * `page` and `request` share the account's session cookie (both come from one browser
 * context), so API set-up calls and the page act as the same person.
 */
export const PASSWORD = "e2e correct horse battery";
export const OWNER = {
  email: "e2e-owner@thread.test",
  password: process.env.THREAD_E2E_OWNER_PASSWORD ?? "",
};

export function uniqueEmail(label = "e2e"): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@thread.test`;
}

/** The newest link of this kind in the local outbox (development API only). */
export async function emailLink(api: APIRequestContext, email: string, path: "verify-email" | "reset-password") {
  let link: string | undefined;
  await expect
    .poll(async () => {
      const mails: { text: string }[] = await (await api.get(`/api/dev/outbox?to=${encodeURIComponent(email)}`)).json();
      link = mails.map((m) => m.text.match(new RegExp(`https?://\\S+/${path}\\?token=[\\w-]+`))?.[0]).find(Boolean);
      return link;
    })
    .toBeTruthy();
  return new URL(link!);
}

export async function signUpVerified(api: APIRequestContext, email: string, name = "E2E Tester") {
  const signUp = await api.post("/api/auth/signup", { data: { email, password: PASSWORD, display_name: name } });
  expect(signUp.status()).toBe(202);
  const token = (await emailLink(api, email, "verify-email")).searchParams.get("token");
  expect((await api.post("/api/auth/verify-email", { data: { token } })).status()).toBe(204);
}

export async function signIn(api: APIRequestContext, email: string, password = PASSWORD) {
  const response = await api.post("/api/auth/login", { data: { email, password } });
  expect(response.status(), await response.text()).toBe(200);
}

type Account = { email: string; owner: boolean } | null;

export const test = base.extend<{ asOwner: boolean; signedIn: boolean; account: Account }>({
  asOwner: [false, { option: true }],
  signedIn: [true, { option: true }],
  account: async ({ context, asOwner, signedIn }, provide) => {
    const api = context.request;
    if (!signedIn) {
      await provide(null);
      return;
    }
    if (asOwner) {
      await signIn(api, OWNER.email, OWNER.password);
      await provide({ email: OWNER.email, owner: true });
      return;
    }
    const email = uniqueEmail();
    await signUpVerified(api, email);
    await signIn(api, email);
    await provide({ email, owner: false });
    // Removes the account's pieces, collections and image files too.
    await api.post("/api/auth/delete-account", { data: { password: PASSWORD } });
  },
  request: async ({ context, account }, provide) => {
    void account; // signed in (or deliberately not) before the test starts
    await provide(context.request);
  },
  page: async ({ page, account }, provide) => {
    void account;
    await provide(page);
  },
});

export { expect };
