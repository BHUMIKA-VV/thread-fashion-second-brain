import { describe, expect, it } from "vitest";

import { MAX_UPLOAD_BYTES, formatBytes, precheckFile } from "./upload-rules";

describe("precheckFile", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])("accepts %s", (type) => {
    expect(precheckFile({ type, size: 1000 })).toBeNull();
  });

  it("defers to the server when the browser reports no type", () => {
    expect(precheckFile({ type: "", size: 1000 })).toBeNull();
  });

  it.each(["image/gif", "image/svg+xml", "application/pdf"])("rejects %s", (type) => {
    expect(precheckFile({ type, size: 1000 })).toMatch(/JPEG, PNG and WebP/);
  });

  it("rejects empty and oversized files", () => {
    expect(precheckFile({ type: "image/png", size: 0 })).toMatch(/empty/);
    expect(precheckFile({ type: "image/png", size: MAX_UPLOAD_BYTES + 1 })).toMatch(/15 MB/);
  });
});

describe("formatBytes", () => {
  it("formats human-readable sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });
});
