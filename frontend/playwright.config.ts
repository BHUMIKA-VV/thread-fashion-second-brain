import { defineConfig, devices } from "@playwright/test";

const isWindows = process.platform === "win32";
const python = isWindows ? ".venv\\Scripts\\python.exe" : ".venv/bin/python";

// E2E runs against a fresh *production* build on its own port. `next dev` compiles and renders
// on demand, and under parallel browsers it slowed to multi-second page loads, which made tests
// flaky. A production server is fast, deterministic and closer to what users get. The dev
// server on :3100 is left alone.
const E2E_PORT = 3101;

/**
 * End-to-end tests run against the real stack: Next.js + FastAPI + the Docker Postgres.
 * Start the database first with `docker compose up -d` from the repo root.
 * A running API on :8010 is reused; the frontend is always rebuilt so tests see current code.
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
      command: `${python} -m uvicorn app.main:app --host 127.0.0.1 --port 8010`,
      cwd: "../backend",
      url: "http://127.0.0.1:8010/health",
      reuseExistingServer: true,
      // A cold start imports scikit-learn and friends; on Windows that alone measured ~30 s.
      timeout: 180_000,
    },
    {
      command: `npm run build && npx next start --hostname 127.0.0.1 --port ${E2E_PORT}`,
      url: `http://127.0.0.1:${E2E_PORT}`,
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
