import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { routeFetch } from "@/test/fetch-router";
import { countView, optedOut, referrerHost, resetCountedViews } from "./beacon";

const privacy = (values: { globalPrivacyControl?: boolean; doNotTrack?: string | null }) => {
  // jsdom has neither signal, so both are defined on the navigator for each test.
  Object.defineProperty(navigator, "doNotTrack", { value: values.doNotTrack ?? null, configurable: true });
  Object.defineProperty(navigator, "globalPrivacyControl", { value: values.globalPrivacyControl, configurable: true });
};

beforeEach(() => {
  resetCountedViews();
  privacy({});
  window.history.replaceState(null, "", "/demo");
});

afterEach(() => {
  vi.restoreAllMocks();
  privacy({});
});

describe("countView", () => {
  it("sends the page, the referring host only and the ref tag, without credentials, once per visit", () => {
    vi.spyOn(document, "referrer", "get").mockReturnValue("https://www.instagram.com/p/abc?igsh=secret");
    window.history.replaceState(null, "", "/demo?ref=insta-nov");
    const fetch = routeFetch({ "POST /api/metrics/view": () => new Response(null, { status: 204 }) });

    countView("demo_view");
    countView("demo_view");

    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = fetch.mock.calls[0];
    expect(JSON.parse(init?.body as string)).toEqual({ event: "demo_view", referrer: "www.instagram.com", ref: "insta-nov" });
    expect(init?.credentials).toBe("omit");
    expect(init?.keepalive).toBe(true);
  });

  it("counts different pages separately", () => {
    const fetch = routeFetch({ "POST /api/metrics/view": () => new Response(null, { status: 204 }) });
    countView("landing_view");
    countView("demo_view");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([{ globalPrivacyControl: true }, { doNotTrack: "1" }])("sends nothing when the browser opts out (%o)", (values) => {
    privacy(values);
    const fetch = vi.spyOn(globalThis, "fetch");
    countView("landing_view");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never throws when the request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    expect(() => countView("pilot_view")).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe("helpers", () => {
  it("keeps only a referrer's host", () => {
    expect(referrerHost("https://www.google.com/search?q=private")).toBe("www.google.com");
    expect(referrerHost("")).toBeNull();
    expect(referrerHost("not a url")).toBeNull();
  });

  it("reads opt-out signals", () => {
    expect(optedOut({ doNotTrack: "0" } as Navigator)).toBe(false);
    expect(optedOut({ doNotTrack: "1" } as Navigator)).toBe(true);
    expect(optedOut({ globalPrivacyControl: true, doNotTrack: null } as Navigator & { globalPrivacyControl: boolean })).toBe(true);
  });
});
