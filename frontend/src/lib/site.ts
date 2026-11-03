import type { Metadata } from "next";

/**
 * The site's public address, for absolute links in metadata, the sitemap and robots.txt.
 * THREAD_PUBLIC_URL is the same setting the API uses for links in emails; it is read when the
 * pages are built, so set it for the build in production.
 */
export const SITE_URL = new URL(process.env.THREAD_PUBLIC_URL || "http://127.0.0.1:3100");

export const SITE_DESCRIPTION =
  "Everything you wear leaves a trace. A personal fashion archive for garments, fabrics, colour and craft.";

/** A real screenshot of a piece and its measured palette (e2e/capture-screenshots.spec.ts). */
const DEFAULT_IMAGE = {
  url: "/screens/og.jpg",
  width: 1200,
  height: 630,
  alt: "Thread: a tie-dyed sari beside the colour palette measured from its photograph",
};

type Share = { title: string; description: string; path?: string; image?: { url: string; alt: string } };

/**
 * Open Graph and Twitter card fields for a page. Metadata merges shallowly, so a page that sets
 * `openGraph` replaces the layout's whole object; this keeps every page's card complete. `path`
 * (public pages only) also sets the canonical address; the layout leaves it out so private
 * pages never point at another page.
 */
export function shareMetadata({ title, description, path, image }: Share): Pick<Metadata, "openGraph" | "twitter" | "alternates"> {
  const images = [image ?? DEFAULT_IMAGE];
  return {
    ...(path && { alternates: { canonical: path } }),
    openGraph: { type: "website", siteName: "Thread", locale: "en_GB", title, description, ...(path && { url: path }), images },
    twitter: { card: "summary_large_image", title, description, images },
  };
}
