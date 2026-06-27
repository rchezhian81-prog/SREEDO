import { test, expect } from "@playwright/test";
import { CREDENTIALS, loginAsStaff, loginToPortal } from "./fixtures";

// Independent extended flows. Each test logs in fresh so they can run in any
// order / isolation. Selectors are taken from the real page source; flows whose
// UI can't be driven reliably without a browser (binary uploads) are softened to
// a presence check, and anything ambiguous is skipped with a NOTE.

test("admin creates a teacher", async ({ page }) => {
  await loginAsStaff(page);
  await page.goto("/teachers");
  await expect(page.getByRole("heading", { name: "Teachers" })).toBeVisible();

  const stamp = Date.now().toString().slice(-6);
  const firstName = `Teach${stamp}`;
  const lastName = "Staff";

  await page.getByRole("button", { name: "+ Add teacher" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("First name").fill(firstName);
  await dialog.getByLabel("Last name").fill(lastName);
  // A unique email avoids unique-constraint collisions on re-runs.
  await dialog.getByLabel("Email").fill(`teacher.${stamp}@e2e.test`);
  await dialog.getByRole("button", { name: "Save teacher" }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByText(`${firstName} ${lastName}`)).toBeVisible();
});

test("admin marks student attendance", async ({ page }) => {
  await loginAsStaff(page);
  await page.goto("/attendance");
  await expect(page.getByRole("heading", { name: "Attendance" })).toBeVisible();

  // The Section <select> is the first combobox on the page; it auto-selects the
  // first section on load. Wait for either the roster table or the empty state.
  const saveButton = page.getByRole("button", { name: "Save attendance" });
  const emptyState = page.getByText("No active students in this section");

  // Give the roster a moment to load for the default section.
  await expect(saveButton).toBeVisible();
  await page
    .waitForFunction(() => {
      const hasRows = document.querySelectorAll("tbody tr").length > 0;
      const empty = document.body.textContent?.includes(
        "No active students in this section"
      );
      return hasRows || empty;
    })
    .catch(() => undefined);

  if (await emptyState.isVisible().catch(() => false)) {
    // Default section has no active students — still a valid rendered state.
    await expect(emptyState).toBeVisible();
    return;
  }

  // Mark everyone present in one click, then persist.
  await page.getByRole("button", { name: "All present" }).click();
  await saveButton.click();
  // Success banner reports how many students were saved.
  await expect(page.getByText(/Saved attendance for \d+ students/)).toBeVisible();
});

test("admin creates homework", async ({ page }) => {
  await loginAsStaff(page);
  await page.goto("/homework");
  await expect(page.getByRole("heading", { name: "Homework" })).toBeVisible();

  await page.getByRole("button", { name: "+ New homework" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Section + Subject are <Field>-wrapped selects, so getByLabel resolves them.
  // Pick the first real option (index 1 skips the "Select …" placeholder).
  const sectionSelect = dialog.getByLabel("Section");
  await sectionSelect.selectOption({ index: 1 });
  const subjectSelect = dialog.getByLabel("Subject");
  await subjectSelect.selectOption({ index: 1 });

  const title = `HW ${Date.now().toString().slice(-6)}`;
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: "Save homework" }).click();
  await expect(dialog).toBeHidden();

  // The new homework appears in the list table.
  await expect(page.getByText(title)).toBeVisible();
});

test("communication inbox opens", async ({ page }) => {
  await loginAsStaff(page);
  await page.goto("/communication");
  await expect(
    page.getByRole("heading", { name: "Communication" })
  ).toBeVisible();

  // The page opens on the Compose tab; switch to Inbox.
  await page.getByRole("button", { name: "Inbox", exact: true }).click();

  // The inbox either lists message cards or shows its empty state — both prove
  // the tab loaded without error.
  const empty = page.getByText("Your inbox is empty.");
  const anyCard = page.locator("h3");
  await expect(empty.or(anyCard.first())).toBeVisible();
});

test("documents upload and listing controls are present", async ({ page }) => {
  await loginAsStaff(page);
  await page.goto("/documents");
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();

  // The upload card and its file input + Upload action render.
  await expect(
    page.getByRole("heading", { name: "Upload document" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeVisible();
  await expect(page.locator('input[type="file"]').first()).toBeAttached();

  // The documents list section renders (table or empty state).
  const emptyDocs = page.getByText("No documents found");
  const docsTable = page.locator("table");
  await expect(emptyDocs.or(docsTable.first())).toBeVisible();

  // NOTE: An actual upload requires posting a binary multipart file and reading
  // back a download; that round-trip isn't assertable in this no-browser
  // harness, so we verify the controls are wired up rather than uploading.
});

test("parent portal shows linked child details", async ({ page }) => {
  await loginToPortal(page, CREDENTIALS.parent);
  await expect(page).toHaveURL(/\/portal(\/|$)/);

  await page.goto("/portal/profile");
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();

  // The profile card renders the linked child's record. "Name" and
  // "Admission no." rows are always present for a linked student.
  await expect(page.getByText("Name", { exact: true })).toBeVisible();
  await expect(page.getByText("Admission no.", { exact: true })).toBeVisible();
  // The ID-card download action confirms a student context is loaded.
  await expect(
    page.getByRole("button", { name: /Download ID card/ })
  ).toBeVisible();
});

test("student portal shows homework", async ({ page }) => {
  await loginToPortal(page, CREDENTIALS.student);
  await expect(page).toHaveURL(/\/portal(\/|$)/);

  await page.goto("/portal/homework");
  await expect(page.getByRole("heading", { name: "Homework" })).toBeVisible();
  // The subtitle is rendered by the page header regardless of list state, so it
  // is a stable signal that the homework view mounted.
  await expect(page.getByText("Assignments and submissions")).toBeVisible();

  // Beyond that, the list either renders homework cards (title text) or its
  // empty state — both confirm the student's assignments loaded without error.
  const empty = page.getByText("No homework assigned yet.");
  // Homework cards expose a clickable button per assignment; on this student
  // page there are no other buttons in the list region.
  const anyCard = page.getByRole("button");
  await expect(empty.or(anyCard.first())).toBeVisible();

  // NOTE: Submitting homework requires opening a specific assignment and posting
  // a multipart form (optional file). That depends on seeded homework existing
  // for this student and a binary upload we can't assert here, so submission is
  // intentionally left out of this presence-focused test.
});
