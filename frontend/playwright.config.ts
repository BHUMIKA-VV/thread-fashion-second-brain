import { randomBytes } from "node:crypto";

import { defineConfig, devices } from "@playwright/test";

const isWindows = process.platform === "win32";
const python = isWindows ? ".venv\\Scripts\\python.exe" : ".venv/bin/python";

// E2E runs against a fresh *production* build on its own port. `next dev` compiles and renders
// on demand, and under parallel browsers it slowed to multi-second page loads, which made tests
// flaky. A production server is fast, deterministic and closer to what users get. The dev
// server on :3100 is left alone.
const E2E_PORT = 3101;
// The API for e2e runs on its own port and database (backend/scripts/e2e_server.py), so your
// development API on :8010 and your archive are never involved.
const E2E_API_PORT = 8011;

// A fresh password for the e2e owner account each run. Set here, in the runner process, so
// the API server and every test worker (both started from it) see the same value.
process.env.THREAD_E2E_OWNER_PASSWORD ??= randomBytes(18).toString("base64url");

/**
 * End-to-end tests run against the real stack: Next.js + FastAPI + the Docker Postgres.
 * Start the database first with `docker compose up -d` from the repo root. Each run starts a
 * fresh API on a throwaway database and rebuilds the frontend, so tests see current code.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: `${python} -m scripts.e2e_server --port ${E2E_API_PORT}`,
      cwd: "../backend",
      url: `http://127.0.0.1:${E2E_API_PORT}/health`,
      // The script also forces the fake deep analyzer (never Claude, even with a key in .env),
      // the local email outbox and no local auto sign-in.
      env: process.env as Record<string, string>,
      reuseExistingServer: false,
      // A cold start imports scikit-learn and friends; on Windows that alone measured ~30 s.
      timeout: 180_000,
    },
    {
      command: `npm run build && npx next start --hostname 127.0.0.1 --port ${E2E_PORT}`,
      url: `http://127.0.0.1:${E2E_PORT}`,
      env: { ...process.env, THREAD_API_URL: `http://127.0.0.1:${E2E_API_PORT}` } as Record<string, string>,
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
