import { test, expect, type Page } from "@playwright/test";
import { installShellMocks, seedSession } from "./fixtures";

/**
 * Shell visual regression. Three states — UI-v2 light, UI-v2 dark, legacy/off-flag
 * — across a fixed desktop + tablet, plus mobile as a no-regression check (the
 * existing mobile layout, not a redesign). The page content (`#main-content`) is
 * masked so only the shell chrome (sidebar + header) is compared.
 */

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
} as const;

async function openShell(page: Page, opts: { uiV2: boolean; dark: boolean }) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installShellMocks(page, { uiV2: opts.uiV2 });
  await seedSession(page, { dark: opts.dark });
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  // Past the shell's spinner gates once the header is painted.
  await page.locator("header").first().waitFor({ state: "visible", timeout: 30_000 });
  // The skin decision must have latched to the expected state before we shoot —
  // never capture a half-resolved frame.
  if (opts.uiV2) await page.locator("html.ui-v2").waitFor({ timeout: 30_000 });
  else await expect(page.locator("html")).not.toHaveClass(/ui-v2/);
  // Fonts settled (Manrope under UI-v2 / system otherwise).
  await page.evaluate(async () => {
    await (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
  });
}

async function shootShell(page: Page, name: string) {
  await expect(page).toHaveScreenshot(name, {
    fullPage: false,
    mask: [page.locator("#main-content")],
  });
}

for (const [vp, size] of Object.entries(VIEWPORTS)) {
  const suffix = vp === "mobile" ? `${vp} (no-regression)` : vp;
  test.describe(`staff shell @ ${suffix}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(size);
    });

    test("UI-v2 light (Modern Soft Premium)", async ({ page }) => {
      await openShell(page, { uiV2: true, dark: false });
      await shootShell(page, `shell-ui-v2-light-${vp}.png`);
    });

    test("UI-v2 dark (Intelligent Glass)", async ({ page }) => {
      await openShell(page, { uiV2: true, dark: true });
      await shootShell(page, `shell-ui-v2-dark-${vp}.png`);
    });

    test("legacy / off-flag (unchanged)", async ({ page }) => {
      await openShell(page, { uiV2: false, dark: false });
      await shootShell(page, `shell-legacy-${vp}.png`);
    });
  });
}
