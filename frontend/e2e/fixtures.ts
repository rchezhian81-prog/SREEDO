import { type Page, expect } from "@playwright/test";

// Credentials from the demo seed (backend `npm run seed`). The E2E suite assumes a
// freshly seeded database.
export const CREDENTIALS = {
  admin: { email: "admin@sreedo.edu", password: "Admin@12345" },
  superAdmin: { email: "super@sreedo.edu", password: "Super@12345" },
  student: { email: "student@sreedo.edu", password: "Student@12345" },
  parent: { email: "parent@sreedo.edu", password: "Parent@12345" },
};

/** Sign in to the staff dashboard and wait until it loads. */
export async function loginAsStaff(
  page: Page,
  creds: { email: string; password: string } = CREDENTIALS.admin
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(creds.email);
  await page.getByLabel("Password").fill(creds.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

/** Sign in to the parent/student portal and wait until it loads. */
export async function loginToPortal(
  page: Page,
  creds: { email: string; password: string }
): Promise<void> {
  await page.goto("/portal/login");
  await page.getByLabel("Email").fill(creds.email);
  await page.getByLabel("Password").fill(creds.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/portal(\/|$)/);
}

/** Navigate via the sidebar to a section by its (English) label. */
export async function gotoSection(page: Page, label: string): Promise<void> {
  await page.getByRole("link", { name: label, exact: true }).first().click();
}
