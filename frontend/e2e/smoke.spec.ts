import { test, expect } from "@playwright/test";
import { CREDENTIALS, loginAsStaff, loginToPortal } from "./fixtures";

// Fast, high-value smoke flows. Tagged @smoke so they can be run on their own:
//   npm run e2e:smoke

test("admin signs in and sees the dashboard @smoke", async ({ page }) => {
  await loginAsStaff(page);
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Students", exact: true })).toBeVisible();
});

test("admin creates a student @smoke", async ({ page }) => {
  await loginAsStaff(page);
  await page.goto("/students");
  const first = `E2E${Date.now().toString().slice(-6)}`;
  await page.getByRole("button", { name: "+ Add student" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("First name").fill(first);
  await dialog.getByLabel("Last name").fill("Tester");
  await dialog.getByRole("button", { name: "Save student" }).click();
  await expect(dialog).toBeHidden();
  await page.getByPlaceholder("Search by name or admission no…").fill(first);
  await expect(page.getByText(`${first} Tester`)).toBeVisible();
});

test("language switcher renders Tamil and back @smoke", async ({ page }) => {
  await loginAsStaff(page);
  const switcher = page.getByLabel("Language");
  await switcher.selectOption("ta");
  // The Students nav label is localised to Tamil.
  await expect(page.getByRole("link", { name: "மாணவர்கள்", exact: true })).toBeVisible();
  await switcher.selectOption("en");
  await expect(page.getByRole("link", { name: "Students", exact: true })).toBeVisible();
});

test("student signs in to the portal @smoke", async ({ page }) => {
  await loginToPortal(page, CREDENTIALS.student);
  await expect(page).toHaveURL(/\/portal(\/|$)/);
});
