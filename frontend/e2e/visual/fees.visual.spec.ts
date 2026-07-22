import { test, expect, type Page } from "@playwright/test";
import { installFeesMocks, seedSession, PERSONAS, type PersonaKey } from "./fees-fixtures";

/**
 * PR-UI7 — Manual Fees visual regression. Privacy-safe synthetic fixtures only;
 * the locale/tz `paidAt` cell (`.fe-paid-date`) is masked everywhere. Two matrices:
 *   • Main list: {School admin, College admin, School empty} × {UI-v2 light,
 *     UI-v2 dark, legacy} × {desktop, tablet, mobile} = 27.
 *   • Modal (desktop): Payments/Adjustments full-perm, Payments/Adjustments
 *     RBAC-restricted, New-invoice, Record-payment × {light, dark, legacy} = 12.
 * Total 39. All network mocked, animations off, fonts + skin-class awaited.
 */

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
} as const;

const MAIN_PERSONAS: PersonaKey[] = ["schoolAdmin", "collegeAdmin", "empty"];
const MASK = (page: Page) => [page.locator(".fe-paid-date")];

async function openFees(page: Page, opts: { persona: PersonaKey; uiV2: boolean; dark: boolean }) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installFeesMocks(page, { persona: opts.persona, uiV2: opts.uiV2 });
  await seedSession(page, { persona: opts.persona, dark: opts.dark });
  await page.goto("/fees", { waitUntil: "domcontentloaded" });
  await page.locator("header").first().waitFor({ state: "visible", timeout: 30_000 });
  if (opts.persona === "empty") await page.getByText("No invoices found").waitFor({ timeout: 30_000 });
  else await page.locator(".fe-table").first().waitFor({ state: "visible", timeout: 30_000 });
  if (opts.uiV2) await page.locator("html.ui-v2").waitFor({ timeout: 30_000 });
  else await expect(page.locator("html")).not.toHaveClass(/ui-v2/);
  await page.evaluate(async () => {
    await (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
  });
}

async function openPaymentsModal(page: Page) {
  await page.getByRole("button", { name: /^View payments/ }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 30_000 });
  // Breakdown + payments both loaded (past the two spinners).
  await dialog.getByText("Sibling discount").waitFor({ timeout: 30_000 });
  await dialog.getByText("RCPT-1001").waitFor({ timeout: 30_000 });
  return dialog;
}

async function openNewInvoiceModal(page: Page) {
  await page.getByRole("button", { name: "+ New invoice" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 30_000 });
  await dialog.locator("option", { hasText: "Asha Rao" }).first().waitFor({ state: "attached", timeout: 30_000 });
  return dialog;
}

async function openRecordPaymentModal(page: Page) {
  await page.getByRole("button", { name: /^Record payment/ }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 30_000 });
  await dialog.getByText(/Outstanding:/).waitFor({ timeout: 30_000 });
  return dialog;
}

// ── Main list (27) ───────────────────────────────────────────────────────────
for (const persona of MAIN_PERSONAS) {
  for (const [vp, size] of Object.entries(VIEWPORTS)) {
    test.describe(`fees · ${persona} @ ${vp}`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize(size);
      });
      test("UI-v2 light (Modern Soft Premium)", async ({ page }) => {
        await openFees(page, { persona, uiV2: true, dark: false });
        await expect(page.locator("#main-content")).toHaveScreenshot(`fees-${persona}-ui-v2-light-${vp}.png`, { mask: MASK(page) });
      });
      test("UI-v2 dark (fully solid)", async ({ page }) => {
        await openFees(page, { persona, uiV2: true, dark: true });
        await expect(page.locator("#main-content")).toHaveScreenshot(`fees-${persona}-ui-v2-dark-${vp}.png`, { mask: MASK(page) });
      });
      test("legacy / off-flag (unchanged)", async ({ page }) => {
        await openFees(page, { persona, uiV2: false, dark: false });
        await expect(page.locator("#main-content")).toHaveScreenshot(`fees-${persona}-legacy-${vp}.png`, { mask: MASK(page) });
      });
    });
  }
}

// ── Modals, desktop (12) ─────────────────────────────────────────────────────
const MODALS: { key: string; persona: PersonaKey; open: (p: Page) => Promise<ReturnType<Page["getByRole"]>> }[] = [
  { key: "payments-full", persona: "schoolAdmin", open: openPaymentsModal },
  { key: "payments-restricted", persona: "restricted", open: openPaymentsModal },
  { key: "new-invoice", persona: "schoolAdmin", open: openNewInvoiceModal },
  { key: "record-payment", persona: "schoolAdmin", open: openRecordPaymentModal },
];

for (const m of MODALS) {
  test.describe(`fees modal · ${m.key} @ desktop`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop);
    });
    test("UI-v2 light (Modern Soft Premium)", async ({ page }) => {
      await openFees(page, { persona: m.persona, uiV2: true, dark: false });
      const dialog = await m.open(page);
      await expect(dialog).toHaveScreenshot(`fees-modal-${m.key}-ui-v2-light-desktop.png`, { mask: MASK(page) });
    });
    test("UI-v2 dark (fully solid)", async ({ page }) => {
      await openFees(page, { persona: m.persona, uiV2: true, dark: true });
      const dialog = await m.open(page);
      await expect(dialog).toHaveScreenshot(`fees-modal-${m.key}-ui-v2-dark-desktop.png`, { mask: MASK(page) });
    });
    test("legacy / off-flag (unchanged)", async ({ page }) => {
      await openFees(page, { persona: m.persona, uiV2: false, dark: false });
      const dialog = await m.open(page);
      await expect(dialog).toHaveScreenshot(`fees-modal-${m.key}-legacy-desktop.png`, { mask: MASK(page) });
    });
  });
}
