import { test, expect, type Page } from "@playwright/test";
import { installStudentsMocks, seedSession, PERSONAS, type PersonaKey } from "./students-fixtures";

/**
 * PR-UI6 — tenant staff Students visual regression. Privacy-safe, synthetic
 * fixtures only. Two matrices:
 *   • Main page: School-admin populated / College-admin populated / School empty
 *     × {UI-v2 light, UI-v2 dark, legacy} × {desktop, tablet, mobile} = 27.
 *   • Add-modal (desktop): School / College × {UI-v2 light, UI-v2 dark, legacy} = 6.
 * Total 33. All network mocked, animations disabled, fonts + skin-class awaited.
 */

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
} as const;

const MAIN_PERSONAS: PersonaKey[] = ["schoolAdmin", "collegeAdmin", "empty"];
const MODAL_PERSONAS: PersonaKey[] = ["schoolAdmin", "collegeAdmin"];

async function openStudents(page: Page, opts: { persona: PersonaKey; uiV2: boolean; dark: boolean }) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installStudentsMocks(page, { persona: opts.persona, uiV2: opts.uiV2 });
  await seedSession(page, { persona: opts.persona, dark: opts.dark });
  await page.goto("/students", { waitUntil: "domcontentloaded" });
  await page.locator("header").first().waitFor({ state: "visible", timeout: 30_000 });
  // Past the page spinner: populated → table; empty → empty state.
  if (opts.persona === "empty") await page.getByText("No students found").waitFor({ timeout: 30_000 });
  else await page.locator(".st-table").first().waitFor({ state: "visible", timeout: 30_000 });
  // Skin decision latched to the expected state before shooting.
  if (opts.uiV2) await page.locator("html.ui-v2").waitFor({ timeout: 30_000 });
  else await expect(page.locator("html")).not.toHaveClass(/ui-v2/);
  await page.evaluate(async () => {
    await (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
  });
}

async function openAddModal(page: Page, persona: PersonaKey) {
  await page.getByRole("button", { name: "+ Add student" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 30_000 });
  // Wait for the async-loaded placement options so the form is fully rendered.
  const option = persona === "collegeAdmin" ? "B.Tech CSE" : "Grade 5 — A";
  await dialog.locator("option", { hasText: option }).first().waitFor({ state: "attached", timeout: 30_000 });
  return dialog;
}

// ── Main page (27) ─────────────────────────────────────────────────────────
for (const persona of MAIN_PERSONAS) {
  for (const [vp, size] of Object.entries(VIEWPORTS)) {
    test.describe(`students · ${persona} @ ${vp}`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize(size);
      });

      test("UI-v2 light (Modern Soft Premium)", async ({ page }) => {
        await openStudents(page, { persona, uiV2: true, dark: false });
        await expect(page.locator("#main-content")).toHaveScreenshot(`students-${persona}-ui-v2-light-${vp}.png`);
      });

      test("UI-v2 dark (fully solid)", async ({ page }) => {
        await openStudents(page, { persona, uiV2: true, dark: true });
        await expect(page.locator("#main-content")).toHaveScreenshot(`students-${persona}-ui-v2-dark-${vp}.png`);
      });

      test("legacy / off-flag (unchanged)", async ({ page }) => {
        await openStudents(page, { persona, uiV2: false, dark: false });
        await expect(page.locator("#main-content")).toHaveScreenshot(`students-${persona}-legacy-${vp}.png`);
      });
    });
  }
}

// ── Add-modal, desktop (6) ───────────────────────────────────────────────────
for (const persona of MODAL_PERSONAS) {
  test.describe(`students modal · ${persona} @ desktop`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop);
    });

    test("UI-v2 light (Modern Soft Premium)", async ({ page }) => {
      await openStudents(page, { persona, uiV2: true, dark: false });
      const dialog = await openAddModal(page, persona);
      await expect(dialog).toHaveScreenshot(`students-modal-${persona}-ui-v2-light-desktop.png`);
    });

    test("UI-v2 dark (fully solid)", async ({ page }) => {
      await openStudents(page, { persona, uiV2: true, dark: true });
      const dialog = await openAddModal(page, persona);
      await expect(dialog).toHaveScreenshot(`students-modal-${persona}-ui-v2-dark-desktop.png`);
    });

    test("legacy / off-flag (unchanged)", async ({ page }) => {
      await openStudents(page, { persona, uiV2: false, dark: false });
      const dialog = await openAddModal(page, persona);
      await expect(dialog).toHaveScreenshot(`students-modal-${persona}-legacy-desktop.png`);
    });
  });
}
