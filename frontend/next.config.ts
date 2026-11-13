import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// The monorepo keeps one .env at the repo root; load it so THREAD_API_URL is shared.
loadEnvConfig(path.resolve(process.cwd(), ".."));

const apiUrl = process.env.THREAD_API_URL ?? "http://127.0.0.1:8010";
const maxUploadBytes = Number(process.env.THREAD_MAX_UPLOAD_BYTES ?? 15 * 1024 * 1024);
const isDev = process.env.NODE_ENV === "development";
// Set by the Dockerfile: a self-contained server bundle (node server.js) for deployment.
const standalone = process.env.THREAD_STANDALONE === "1";

// Everything is served from this origin (fonts are self-hosted by next/font, images come
// through /api). 'unsafe-inline' scripts are needed by Next.js without nonces; nonces would
// force every page to render dynamically (see the Next.js CSP guide). 'unsafe-eval' is only
// for React's development tooling. No upgrade-insecure-requests: the app runs on plain http
// locally, and upgrading same-origin requests to https would break it.
function csp(extra: { script?: string; frame?: string; connect?: string; img?: string } = {}) {
  const more = (sources?: string) => (sources ? ` ${sources}` : "");
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}${more(extra.script)}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data:${more(extra.img)}`,
    "font-src 'self'",
    `connect-src 'self'${more(extra.connect)}`,
    ...(extra.frame ? [`frame-src ${extra.frame}`] : []),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const contentSecurityPolicy = csp();

// Razorpay Checkout runs on /account/billing only, so only that page may load its script,
// frame and API. These origins are the ones Checkout is known to use; Razorpay's docs don't
// publish a list, so test it in the browser before going live. The page also lets Checkout
// open payment pop-ups (some UPI and netbanking flows), which same-origin COOP would cut off.
// Links to the page must load it fully (a plain <a>), because a page's CSP is the one sent
// with the document it was opened in.
const CHECKOUT_PATH = "/account/billing"; // also in src/features/billing/paths.ts
const checkoutContentSecurityPolicy = csp({
  script: "https://checkout.razorpay.com",
  frame: "https://api.razorpay.com https://checkout.razorpay.com",
  connect: "https://api.razorpay.com https://lumberjack.razorpay.com",
  img: "https://cdn.razorpay.com",
});

export const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  // Links out to a piece's source URL never carry this app's URLs.
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // The upload page may use the camera; nothing else is needed.
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // Production builds: browsers remember to use HTTPS only (ignored over plain http, so a
  // local production build is unaffected). No preload: that is a separate, lasting decision.
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  ...(standalone ? { output: "standalone" as const } : {}),
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // Later rules win for the same header, so this replaces only these two on that page.
      {
        source: CHECKOUT_PATH,
        headers: [
          { key: "Content-Security-Policy", value: checkoutContentSecurityPolicy },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
        ],
      },
    ];
  },
  experimental: {
    // Next buffers proxied request bodies and, by default, truncates them at 10 MB, which
    // broke uploads between 10 and 15 MB. Allow 2x the API limit so slightly-too-large files
    // still reach FastAPI whole and get its proper 413 instead of a dropped connection.
    proxyClientMaxBodySize: maxUploadBytes * 2,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // The browser only ever talks to this Next.js origin. /api/* is proxied to FastAPI,
  // so there is no CORS setup and private images can stay behind the API later on.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
};

export default nextConfig;
