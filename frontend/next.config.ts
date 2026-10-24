import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// The monorepo keeps one .env at the repo root; load it so THREAD_API_URL is shared.
loadEnvConfig(path.resolve(process.cwd(), ".."));

const apiUrl = process.env.THREAD_API_URL ?? "http://127.0.0.1:8010";
const maxUploadBytes = Number(process.env.THREAD_MAX_UPLOAD_BYTES ?? 15 * 1024 * 1024);

const nextConfig: NextConfig = {
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
