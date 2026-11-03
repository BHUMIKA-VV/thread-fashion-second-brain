import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { DEMO } from "@/features/demo/demo-data";

import { shareMetadata } from "./site";

describe("shareMetadata", () => {
  it("gives a public page a full card and a canonical address", () => {
    const meta = shareMetadata({ title: "Explore Thread", description: "Demo", path: "/demo" });
    expect(meta.alternates).toEqual({ canonical: "/demo" });
    expect(meta.openGraph).toMatchObject({ siteName: "Thread", title: "Explore Thread", url: "/demo", images: [{ url: "/screens/og.jpg", width: 1200, height: 630 }] });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", title: "Explore Thread" });
  });

  it("without a path (the layout), points no page at another", () => {
    const meta = shareMetadata({ title: "Thread", description: "x" });
    expect(meta.alternates).toBeUndefined();
    expect(meta.openGraph).not.toHaveProperty("url");
  });

  it("uses a page's own image when it has one", () => {
    const meta = shareMetadata({ title: "t", description: "d", path: "/p", image: { url: "/demo/images/a.webp", alt: "A" } });
    expect(meta.openGraph?.images).toEqual([{ url: "/demo/images/a.webp", alt: "A" }]);
  });
});

describe("sitemap and robots", () => {
  const urls = sitemap().map((entry) => new URL(entry.url).pathname);

  it("lists the public pages and every demo page", () => {
    expect(urls).toEqual(expect.arrayContaining(["/", "/demo", "/how-it-works", "/privacy", "/terms"]));
    for (const piece of DEMO.pieces) expect(urls).toContain(`/demo/pieces/${piece.id}`);
    for (const c of DEMO.collections) expect(urls).toContain(`/demo/collections/${c.id}`);
    for (const o of DEMO.outfits) expect(urls).toContain(`/demo/outfits/${o.id}`);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("never lists a private archive page", () => {
    const { disallow } = robots().rules as { disallow: string[] };
    for (const url of urls) {
      expect(disallow.some((prefix) => url.startsWith(prefix)), url).toBe(false);
    }
    expect(disallow).toEqual(expect.arrayContaining(["/api/", "/gallery", "/items/", "/settings"]));
    expect(robots().sitemap).toMatch(/\/sitemap\.xml$/);
  });
});
