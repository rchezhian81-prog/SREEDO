import { defineConfig } from "@playwright/test";

/**
 * PR-UI3 — deterministic staff-shell visual regression.
 *
 * Separate from any functional e2e: it builds the app with the UI-v2 build
 * master switch ON, serves it, and screenshots ONLY the authenticated staff
 * shell (sidebar + header) with the page content masked, across fixed
 * viewports, with ALL network mocked, stable fixtures (no production/personal
 * data), animations disabled, and fonts awaited. CI runs this inside the pinned
 * Playwright container (`mcr.microsoft.com/playwright:v1.51.1-noble`) so the
 * committed baselines match byte-for-byte. Regenerate intentionally with
 * `npm run test:visual:update` — see docs/product-excellence/UI-VISUAL-REGRESSION.md.
 */

const PORT = 3210;

export default defineConfig({
  testDir: "./e2e/visual",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "list" : "line",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    deviceScaleFactor: 1,
    timezoneId: "UTC",
    locale: "en-US",
    // reduced-motion is emulated per-test (see the spec) so the app renders its
    // reduced-motion styles for a stable, animation-free capture.
  },
  expect: {
    toHaveScreenshot: {
      // A small tolerance absorbs sub-pixel antialiasing noise while still
      // failing on any material colour / layout / spacing drift.
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  webServer: {
    // NEXT_PUBLIC_* is inlined at build time, so the master switch must be set
    // for the build. Serving on a dedicated port keeps it off the dev port.
    command: "npm run build:visual && npm run start:visual",
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
