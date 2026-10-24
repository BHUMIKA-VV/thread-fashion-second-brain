import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// The monorepo keeps one .env at the repo root; load it so THREAD_API_URL is shared.
loadEnvConfig(path.resolve(process.cwd(), ".."));

const apiUrl = process.env.THREAD_API_URL ?? "http://127.0.0.1:8010";

const nextConfig: NextConfig = {
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
