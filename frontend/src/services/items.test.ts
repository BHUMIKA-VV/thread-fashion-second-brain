import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api-client";
import { uploadItem } from "./items";

/** Minimal stand-in for XMLHttpRequest that the test drives by hand. */
class FakeXHR {
  static last: FakeXHR;
  method = "";
  url = "";
  status = 0;
  responseText = "";
  body: FormData | null = null;
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  aborted = false;

  constructor() {
    FakeXHR.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: FormData) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = typeof body === "string" ? body : JSON.stringify(body);
    this.onload?.();
  }
}

const file = new File([new Uint8Array([1, 2, 3])], "look.jpg", { type: "image/jpeg" });

afterEach(() => vi.unstubAllGlobals());

describe("uploadItem", () => {
  it("posts multipart data to the proxy and reports progress", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const progress: number[] = [];

    const promise = uploadItem(file, { type: "fabric", onProgress: (f) => progress.push(f) });
    const xhr = FakeXHR.last;
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
    xhr.respond(201, { id: "abc", type: "fabric" });

    await expect(promise).resolves.toMatchObject({ id: "abc" });
    expect([xhr.method, xhr.url]).toEqual(["POST", "/api/items"]);
    expect(xhr.body?.get("type")).toBe("fabric");
    expect(xhr.body?.get("file")).toBeInstanceOf(File);
    expect(progress).toEqual([0.5, 1]);
  });

  it("surfaces the duplicate's existing id from a 409", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const promise = uploadItem(file, { type: "other" });
    FakeXHR.last.respond(409, {
      error: { code: "conflict", message: "Already saved", details: { existing_item_id: "old-1" } },
    });

    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, details: { existing_item_id: "old-1" } });
  });

  it("maps validation and network failures to ApiError", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const invalid = uploadItem(file, { type: "other" });
    FakeXHR.last.respond(415, {
      error: { code: "unsupported_format", message: "Only JPEG, PNG and WebP", details: null },
    });
    await expect(invalid).rejects.toMatchObject({ status: 415, code: "unsupported_format" });

    const offline = uploadItem(file, { type: "other" });
    FakeXHR.last.onerror?.();
    await expect(offline).rejects.toMatchObject({ status: 0, code: "network_error" });
  });

  it("aborts when the signal fires", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const controller = new AbortController();
    const promise = uploadItem(file, { type: "other", signal: controller.signal });

    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeXHR.last.aborted).toBe(true);
  });
});
