import type { Page } from "@playwright/test";

/**
 * PR-UI7 — deterministic, privacy-safe Manual Fees fixtures.
 *
 * Four synthetic staff personas — School admin (populated), College admin
 * (populated), School empty, and an RBAC-restricted staff member (holds
 * fees:manage/fees:payment/fee_*:read but NOT the fine/discount apply/waive/
 * approve keys). All financial data is obviously synthetic: fake invoice
 * numbers, fake student names, fake amounts, fake references. NO production
 * API/DB and NO real student/receipt/financial data ever appear here or in any
 * artifact. The `paidAt` cell is masked in every screenshot (see the spec).
 */

export type PersonaKey = "schoolAdmin" | "collegeAdmin" | "empty" | "restricted";

const READS = [
  "students:read", "attendance:read", "exams:read", "staff:read", "timetable:read",
  "communication:read", "reports:read", "academics:read", "admissions:read",
];
// Full fee capability (admin/accountant).
const FULL_FEE = [
  "fees:manage", "fees:payment",
  "fee_fines:read", "fee_fines:apply", "fee_fines:waive",
  "fee_discounts:read", "fee_discounts:apply", "fee_discounts:approve",
];
// Restricted: can raise invoices/record payments + read fines/discounts, but
// cannot apply/waive fines or apply/approve discounts.
const RESTRICTED_FEE = ["fees:manage", "fees:payment", "fee_fines:read", "fee_discounts:read"];

const ENABLED_MODULES = [
  "students", "fees", "attendance", "exams", "staff", "timetable", "communication",
  "reports", "academics", "admissions",
];

const SCHOOL_INVOICES = [
  { id: "i1", invoiceNo: "INV-0001", studentName: "Asha Rao", description: "Term 1 Tuition", amountDue: 15000, amountPaid: 7000, status: "partially_paid" },
  { id: "i2", invoiceNo: "INV-0002", studentName: "Vikram Nair", description: "Term 1 Tuition", amountDue: 15000, amountPaid: 15000, status: "paid" },
  { id: "i3", invoiceNo: "INV-0003", studentName: "Meera Iyer", description: "Bus Fee", amountDue: 4000, amountPaid: 0, status: "pending" },
  { id: "i4", invoiceNo: "INV-0004", studentName: "Arjun Menon", description: "Lab Fee", amountDue: 2500, amountPaid: 0, status: "cancelled" },
  { id: "i5", invoiceNo: "INV-0005", studentName: "Divya Pillai", description: "Term 2 Tuition", amountDue: 15000, amountPaid: 5000, status: "partially_paid" },
];
const COLLEGE_INVOICES = [
  { id: "c1", invoiceNo: "REG-INV-2001", studentName: "Nisha Verma", description: "Semester 5 Tuition", amountDue: 42000, amountPaid: 20000, status: "partially_paid" },
  { id: "c2", invoiceNo: "REG-INV-2002", studentName: "Rahul Bose", description: "Semester 3 Tuition", amountDue: 42000, amountPaid: 42000, status: "paid" },
  { id: "c3", invoiceNo: "REG-INV-2003", studentName: "Farah Khan", description: "Hostel Fee", amountDue: 18000, amountPaid: 0, status: "pending" },
  { id: "c4", invoiceNo: "REG-INV-2004", studentName: "Dev Kapoor", description: "Exam Fee", amountDue: 3000, amountPaid: 0, status: "cancelled" },
];

const SCHOOL_SUMMARY = { totalInvoiced: 51500, totalCollected: 27000, outstanding: 24500 };
const COLLEGE_SUMMARY = { totalInvoiced: 105000, totalCollected: 62000, outstanding: 43000 };

// A fixed, rich invoice detail returned for ANY /fees/invoices/:id (so a
// "View payments" click always opens a populated Adjustments + Payments modal).
const INVOICE_DETAIL = {
  id: "i1", invoiceNo: "INV-0001", studentId: "s1", studentName: "Asha Rao",
  description: "Term 1 Tuition", amountDue: 15000, amountPaid: 7000, status: "partially_paid",
  payments: [
    { id: "p1", amount: 5000, method: "cash", reference: "RCPT-1001", paidAt: "2026-07-05T09:00:00Z" },
    { id: "p2", amount: 2000, method: "upi", reference: "UPI-88231", paidAt: "2026-07-09T09:00:00Z" },
  ],
};
const INVOICE_BREAKDOWN = {
  studentId: "s1", base: 15000, fineTotal: 500, discountTotal: 1000, outstanding: 7500,
  fines: [{ id: "f1", reason: "Late fee", days: 5, amount: 500, status: "applied" }],
  discounts: [{ id: "d1", reason: "Sibling discount", amount: 1000, status: "pending" }],
};
const FINE_RULES = [{ id: "fr1", name: "Late fee — fixed 500" }];
const DISCOUNT_LIST = [{ id: "dsc1", name: "Sibling discount" }];
const STUDENT_PICKER = [
  { id: "s1", firstName: "Asha", lastName: "Rao", admissionNo: "ADM-1001" },
  { id: "s2", firstName: "Vikram", lastName: "Nair", admissionNo: "ADM-1002" },
];

type Persona = {
  mode: "school" | "college";
  institutionType: "school" | "college";
  institutionName: string;
  permissions: string[];
  invoices: unknown[];
  summary: unknown;
};

export const PERSONAS: Record<PersonaKey, Persona> = {
  schoolAdmin: { mode: "school", institutionType: "school", institutionName: "Demo Public School", permissions: [...FULL_FEE, ...READS], invoices: SCHOOL_INVOICES, summary: SCHOOL_SUMMARY },
  collegeAdmin: { mode: "college", institutionType: "college", institutionName: "Demo Institute of Technology", permissions: [...FULL_FEE, ...READS], invoices: COLLEGE_INVOICES, summary: COLLEGE_SUMMARY },
  empty: { mode: "school", institutionType: "school", institutionName: "Demo Public School", permissions: [...FULL_FEE, ...READS], invoices: [], summary: { totalInvoiced: 0, totalCollected: 0, outstanding: 0 } },
  restricted: { mode: "school", institutionType: "school", institutionName: "Demo Public School", permissions: [...RESTRICTED_FEE, ...READS], invoices: SCHOOL_INVOICES, summary: SCHOOL_SUMMARY },
};

const USER = (p: Persona, key: PersonaKey) => ({
  id: `00000000-0000-0000-0000-0000000000${key === "collegeAdmin" ? "bb" : "aa"}`,
  email: "fees.staff@example.test",
  fullName: "Demo Staff",
  role: "admin",
  institutionId: `00000000-0000-0000-0000-0000000000${key === "collegeAdmin" ? "bb" : "aa"}`,
  institutionName: p.institutionName,
  institutionType: p.institutionType,
});

/** Seed the persisted session, explicit theme, and campus mode before app JS. */
export async function seedSession(page: Page, opts: { persona: PersonaKey; dark: boolean }) {
  const p = PERSONAS[opts.persona];
  const user = USER(p, opts.persona);
  await page.addInitScript(
    ([u, mode, dark]) => {
      localStorage.setItem("sreedo-auth", JSON.stringify({
        state: { user: u, accessToken: "visual-fixture-token", refreshToken: "visual-fixture-refresh", support: null },
        version: 0,
      }));
      localStorage.setItem("sreedo-mode", JSON.stringify({ state: { mode, hasChosen: true }, version: 0 }));
      localStorage.setItem("gocampus-theme", dark ? "dark" : "light");
    },
    [user, p.mode, opts.dark] as const
  );
}

/** Stub every shell + Fees API call; `uiV2` drives the audited tenant flag. */
export async function installFeesMocks(page: Page, opts: { persona: PersonaKey; uiV2: boolean }) {
  const p = PERSONAS[opts.persona];
  const user = USER(p, opts.persona);
  await page.route("**/api/v1/**", async (route) => {
    const url = route.request().url();
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

    // Shell
    if (url.includes("/auth/me"))
      return json({ ...user, enabledModules: ENABLED_MODULES, twoFactorEnabled: false, uiV2Enabled: opts.uiV2 });
    if (url.includes("/auth/permissions")) return json({ role: user.role, permissions: p.permissions });
    if (url.includes("/branding"))
      return json({ displayName: p.institutionName, logoUrl: null, primaryColor: null, tagline: "Excellence in Education" });
    if (url.includes("/academic-years")) return json([{ id: "yr1", name: "2026-27", isCurrent: true }]);
    if (url.includes("/communication/inbox/unread-count")) return json({ count: 0 });

    // Fees (order matters — most specific first)
    if (url.includes("/fees/summary")) return json(p.summary);
    if (url.includes("/fees/invoices/") && url.includes("/breakdown")) return json(INVOICE_BREAKDOWN);
    if (url.includes("/fees/invoices/")) return json(INVOICE_DETAIL);
    if (url.includes("/fees/invoices")) return json({ data: p.invoices, meta: { total: (p.invoices as unknown[]).length, page: 1, limit: 50 } });
    if (url.includes("/fees/fine-rules")) return json(FINE_RULES);
    if (url.includes("/fees/discounts")) return json(DISCOUNT_LIST);
    if (url.includes("/students")) return json({ data: STUDENT_PICKER, meta: { total: STUDENT_PICKER.length, page: 1, limit: 100 } });
    if (url.includes("/search")) return json({ results: [] });

    // Anything else must NOT be requested — abort so a stray call can never leak
    // data or make the screenshot non-deterministic.
    return route.abort();
  });
}
