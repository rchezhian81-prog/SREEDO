import { test, expect, type Page } from "@playwright/test";
import { installDashboardMocks, seedSession, PERSONAS, type PersonaKey } from "./dashboard-fixtures";

/**
 * PR-UI5 — tenant staff Dashboard visual regression. Three synthetic personas
 * (School admin, College admin, fees-less staff) × three states (UI-v2 light,
 * UI-v2 dark, legacy/off-flag) × three fixed viewports = 27 deterministic
 * baselines. Only the page content (`#main-content`) is captured — the shell
 * chrome is already guarded by the PR-UI3 shell suite. All network is mocked, no
 * personal/production data is used, animations are disabled, and the run waits
 * for the skin class to latch + fonts to settle before shooting.
 */

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
} as const;

const PERSONA_KEYS = Object.keys(PERSONAS) as PersonaKey[];

async function openDashboard(
  page: Page,
  opts: { persona: PersonaKey; uiV2: boolean; dark: boolean }
) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installDashboardMocks(page, { persona: opts.persona, uiV2: opts.uiV2 });
  await seedSession(page, { persona: opts.persona, dark: opts.dark });
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  // Past the shell spinner (header painted) …
  await page.locator("header").first().waitFor({ state: "visible", timeout: 30_000 });
  // … and past the Dashboard's own spinner (summary rendered → stat cards exist).
  await page.locator(".db-stat").first().waitFor({ state: "visible", timeout: 30_000 });
  // The skin decision must have latched to the expected state before we shoot.
  if (opts.uiV2) await page.locator("html.ui-v2").waitFor({ timeout: 30_000 });
  else await expect(page.locator("html")).not.toHaveClass(/ui-v2/);
  // Fonts settled (Manrope under UI-v2 / system otherwise).
  await page.evaluate(async () => {
    await (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
  });
}

async function shoot(page: Page, name: string) {
  // Content area only. Announcement dates are locale/tz-formatted, so mask them
  // (belt-and-suspenders on top of the fixed UTC / en-US context).
  await expect(page.locator("#main-content")).toHaveScreenshot(name, {
    mask: [page.locator(".db-ann-date")],
  });
}

for (const persona of PERSONA_KEYS) {
  for (const [vp, size] of Object.entries(VIEWPORTS)) {
    test.describe(`dashboard · ${persona} @ ${vp}`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize(size);
      });

      test("UI-v2 light (Modern Soft Premium)", async ({ page }) => {
        await openDashboard(page, { persona, uiV2: true, dark: false });
        await shoot(page, `dash-${persona}-ui-v2-light-${vp}.png`);
      });

      test("UI-v2 dark (Intelligent Glass)", async ({ page }) => {
        await openDashboard(page, { persona, uiV2: true, dark: true });
        await shoot(page, `dash-${persona}-ui-v2-dark-${vp}.png`);
      });

      test("legacy / off-flag (unchanged)", async ({ page }) => {
        await openDashboard(page, { persona, uiV2: false, dark: false });
        await shoot(page, `dash-${persona}-legacy-${vp}.png`);
      });
    });
  }
}
