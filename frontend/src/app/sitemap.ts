import type { MetadataRoute } from "next";

import { DEMO } from "@/features/demo/demo-data";
import { SITE_URL } from "@/lib/site";

/**
 * The public pages: the landing page, the demo (every piece, collection and outfit), how it
 * works, the legal pages and the way in. Private archive pages are never listed; the showcase
 * holds pieces people chose to publish, so only its index is listed, not each piece.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    "/",
    "/demo",
    ...DEMO.pieces.map((p) => `/demo/pieces/${p.id}`),
    ...DEMO.collections.map((c) => `/demo/collections/${c.id}`),
    ...DEMO.outfits.map((o) => `/demo/outfits/${o.id}`),
    "/how-it-works",
    "/showcase",
    "/privacy",
    "/terms",
    "/signup",
    "/login",
  ];
  return paths.map((path) => ({ url: new URL(path, SITE_URL).href }));
}
