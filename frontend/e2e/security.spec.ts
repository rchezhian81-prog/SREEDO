import { test, expect } from "@playwright/test";
import { CREDENTIALS, loginToPortal } from "./fixtures";

// UI authorization guards. Data-level isolation (cross-student, cross-tenant,
// cross-child) is enforced and covered by the backend API contract tests; here we
// confirm the browser-facing guards: unauthenticated users can't reach protected
// areas, and roles are kept on their own side.

test("unauthenticated user is redirected away from the staff dashboard @smoke", async ({ page }) => {
  await page.goto("/dashboard");
  await page.waitForURL("**/login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("unauthenticated user is redirected away from the portal", async ({ page }) => {
  await page.goto("/portal");
  await page.waitForURL("**/portal/login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("a portal (student) account cannot reach the staff dashboard", async ({ page }) => {
  await loginToPortal(page, CREDENTIALS.student);
  // The staff dashboard requires a staff session — a portal student is bounced
  // back to a login screen rather than seeing staff data.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/(login|portal)/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toHaveCount(0);
});
