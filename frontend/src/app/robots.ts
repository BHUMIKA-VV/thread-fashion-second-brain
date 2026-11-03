import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/**
 * Crawlers may read the public pages; the API and the pages that belong to an account are
 * off limits. These pages need a session anyway, so this only keeps sign-in screens out of
 * search results; it is not access control.
 */
const PRIVATE = [
  "/api/",
  "/gallery",
  "/items/",
  "/upload",
  "/collections",
  "/outfit-studio",
  "/colour-lab",
  "/dashboard",
  "/settings",
  "/account",
  "/accounts",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: PRIVATE },
    sitemap: new URL("/sitemap.xml", SITE_URL).href,
  };
}
