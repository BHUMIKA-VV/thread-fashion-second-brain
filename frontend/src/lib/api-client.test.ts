import { describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "./api-client";

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("apiFetch", () => {
  it("prefixes requests with the /api proxy and returns JSON", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: 1 }, 200));

    await expect(apiFetch("/things")).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledWith("/api/things", undefined);
  });

  it("maps the backend's structured error body to ApiError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: { code: "not_found", message: "Not Found", details: null } }, 404),
    );

    const error = await apiFetch("/missing").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: "not_found", message: "Not Found" });
  });

  it("reports an unreachable backend when the proxy returns a non-JSON 500", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Internal Server Error", { status: 500 }));

    await expect(apiFetch("/health")).rejects.toMatchObject({ code: "unreachable" });
  });

  it("reports network failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(apiFetch("/health")).rejects.toMatchObject({ status: 0, code: "network_error" });
  });
});
