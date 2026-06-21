import { defineConfig, devices } from "@playwright/test";

// E2E config. The suite is NOT part of normal CI (it needs the full stack +
// browsers); CI only runs `e2e:validate` (test --list) to keep the specs honest.
// Run it manually against a locally running stack (see docs/E2E_TESTING.md):
//   - backend on :4000 (seeded), frontend on :3000.
// `@smoke`-tagged tests are the fast subset; the rest is the extended suite.
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // Fail fast in CI-like runs; retry once locally to absorb flakiness.
  retries: process.env.CI ? 0 : 1,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Auto-start the frontend (reused if already running). The backend must be
  // started separately and seeded; point the app at it via NEXT_PUBLIC_API_URL.
  webServer: process.env.E2E_NO_WEBSERVER
    ? undefined
    : {
        command: "npm run dev",
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 120_000,
        env: { NEXT_PUBLIC_API_URL: API_URL },
      },
});
