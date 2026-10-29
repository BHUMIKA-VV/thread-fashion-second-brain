import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// The monorepo keeps one .env at the repo root; load it so THREAD_API_URL is shared.
loadEnvConfig(path.resolve(process.cwd(), ".."));

const apiUrl = process.env.THREAD_API_URL ?? "http://127.0.0.1:8010";
const maxUploadBytes = Number(process.env.THREAD_MAX_UPLOAD_BYTES ?? 15 * 1024 * 1024);
const isDev = process.env.NODE_ENV === "development";

// Everything is served from this origin (fonts are self-hosted by next/font, images come
// through /api). 'unsafe-inline' scripts are needed by Next.js without nonces; nonces would
// force every page to render dynamically (see the Next.js CSP guide). 'unsafe-eval' is only
// for React's development tooling. No upgrade-insecure-requests: the app runs on plain http
// locally, and upgrading same-origin requests to https would break it.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

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
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
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
