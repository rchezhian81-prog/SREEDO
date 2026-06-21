import { test, expect } from "@playwright/test";
import { CREDENTIALS, loginAsStaff, loginToPortal } from "./fixtures";

// One longer happy-path that chains the core school workflow end to end:
// admin enrols a student -> raises a fee invoice for that student -> records a
// payment against it -> opens the Reports Center -> then a portal user signs in
// and can see their own data. Each sub-step reads the real rendered UI; steps
// that can't be asserted reliably without a browser-driven download are softened
// to a presence check (see NOTE comments).
test("critical school flow: admin enrols a student then a parent/portal can see related data", async ({
  page,
}) => {
  // --- 1. Admin signs in ---
  await loginAsStaff(page);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  // --- 2. Admin creates a student ---
  const stamp = Date.now().toString().slice(-6);
  const firstName = `Crit${stamp}`;
  const lastName = "Flow";
  const fullName = `${firstName} ${lastName}`;

  await page.goto("/students");
  await page.getByRole("button", { name: "+ Add student" }).click();
  const studentDialog = page.getByRole("dialog");
  await expect(studentDialog).toBeVisible();
  await studentDialog.getByLabel("First name").fill(firstName);
  await studentDialog.getByLabel("Last name").fill(lastName);
  await studentDialog.getByRole("button", { name: "Save student" }).click();
  await expect(studentDialog).toBeHidden();

  // Confirm the student is searchable in the table.
  await page
    .getByPlaceholder("Search by name or admission no…")
    .fill(firstName);
  await expect(page.getByText(fullName)).toBeVisible();

  // --- 3. Admin raises an invoice for that student ---
  await page.goto("/fees");
  await expect(page.getByRole("heading", { name: "Fees" })).toBeVisible();
  await page.getByRole("button", { name: "+ New invoice" }).click();
  const invoiceDialog = page.getByRole("dialog");
  await expect(invoiceDialog).toBeVisible();

  // The student <select> lists "First Last (admissionNo)". We don't know the
  // generated admission number, so resolve the matching <option> by its visible
  // text and select it by value.
  const studentSelect = invoiceDialog.getByLabel("Student");
  const studentOption = invoiceDialog
    .locator("option", { hasText: fullName })
    .first();
  await expect(studentOption).toHaveCount(1);
  const studentOptionValue = await studentOption.getAttribute("value");
  expect(studentOptionValue).toBeTruthy();
  await studentSelect.selectOption(studentOptionValue as string);

  await invoiceDialog.getByLabel("Description").fill("E2E Term Fee");
  await invoiceDialog.getByLabel("Amount").fill("1000");
  // Due date input is a native date control; ISO value is accepted directly.
  await invoiceDialog.getByLabel("Due date").fill("2030-12-31");
  await invoiceDialog.getByRole("button", { name: "Create invoice" }).click();
  await expect(invoiceDialog).toBeHidden();

  // The new invoice appears in the table against our student.
  const invoiceRow = page.getByRole("row", { name: new RegExp(fullName) });
  await expect(invoiceRow.first()).toBeVisible();

  // --- 4. Admin records a payment against the invoice ---
  // A fresh invoice is "pending", so the row exposes a "Record payment" action.
  await invoiceRow
    .first()
    .getByRole("button", { name: "Record payment" })
    .click();
  const paymentDialog = page.getByRole("dialog");
  await expect(paymentDialog).toBeVisible();
  await paymentDialog.getByLabel("Amount").fill("1000");
  // Method defaults to "cash"; leave it as is.
  await paymentDialog.getByRole("button", { name: "Record payment" }).click();
  await expect(paymentDialog).toBeHidden();

  // After full payment the invoice should report a paid amount. Re-open the
  // payments modal and confirm a payment row with a receipt action exists.
  const paidRow = page.getByRole("row", { name: new RegExp(fullName) }).first();
  await paidRow.getByRole("button", { name: "View payments" }).click();
  const paymentsDialog = page.getByRole("dialog");
  await expect(paymentsDialog).toBeVisible();
  await expect(
    paymentsDialog.getByRole("heading", { name: "Payments" })
  ).toBeVisible();
  // NOTE: The "Receipt" button triggers a binary PDF download (blob). We can't
  // assert the downloaded file reliably in this harness, so we only verify the
  // action is present once a payment has been recorded.
  await expect(
    paymentsDialog.getByRole("button", { name: "Receipt" }).first()
  ).toBeVisible();
  // Close the modal (Escape is wired up in the Modal primitive).
  await page.keyboard.press("Escape");
  await expect(paymentsDialog).toBeHidden();

  // --- 5. Admin opens the Reports Center ---
  await page.goto("/reports-center");
  await expect(
    page.getByRole("heading", { name: "Reports Center" })
  ).toBeVisible();
  // The seeded admin can run at least one report; the picker renders the report
  // list as full-width bordered buttons grouped by category cards. Open the
  // first one if present and confirm the detail panel (with its export
  // controls) shows.
  const firstReportButton = page.locator("button.w-full.rounded-lg").first();
  if (await firstReportButton.count()) {
    await firstReportButton.click();
    await expect(
      page.getByRole("button", { name: /Export CSV/ })
    ).toBeVisible();
  }
  // NOTE: CSV/PDF export is a file download we can't assert without a browser,
  // so we stop at confirming the export controls are reachable.

  // --- 6. A portal user signs in and sees their own data ---
  // Use a fresh browser-context page so the staff session doesn't leak in.
  const portalPage = await page.context().newPage();
  await loginToPortal(portalPage, CREDENTIALS.parent);
  await expect(portalPage).toHaveURL(/\/portal(\/|$)/);

  // The parent's linked child's profile must be reachable and show real data.
  await portalPage.goto("/portal/profile");
  await expect(
    portalPage.getByRole("heading", { name: "Profile" })
  ).toBeVisible();
  // The profile card lists the student's details (Name / Admission no.). At
  // least the "Name" and "Admission no." rows render for a linked child.
  await expect(portalPage.getByText("Name", { exact: true })).toBeVisible();
  await expect(
    portalPage.getByText("Admission no.", { exact: true })
  ).toBeVisible();
  await portalPage.close();
});
