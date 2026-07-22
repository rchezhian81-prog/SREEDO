// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * PR-UI7 — Manual Fees. jsdom pins the contracts independent of pixels:
 *   1. Data parity — summary + invoice rows equal the payload (school + college).
 *   2. Request parity — only fees endpoints (+ /students picker + permissions).
 *   3. RBAC visibility — the RESTRICTED persona hides Apply-fine/Apply-discount
 *      controls + Waive/Approve columns; New-invoice + Record-payment stay
 *      rendered (server-enforced) — current behaviour preserved.
 *   4. Record-payment Outstanding math; modal opens.
 *   5. a11y is eligible-UI-v2-ONLY (off-flag byte-identical).
 *   6. Frozen-surface — every `.fe-` rule is `.ui-v2`-scoped, no glass, no gold,
 *      and the `@media print` (forced-light) block is untouched by Fees.
 */

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: { get: getMock, post: postMock }, ApiError: class ApiError extends Error {} }));
vi.mock("@/i18n/I18nProvider", () => ({ useI18n: () => ({ t: (k: string) => k }) }));

import FeesPage from "./page";
import { useSkinStore } from "@/stores/skin-store";

const FULL = ["fees:manage", "fees:payment", "fee_fines:read", "fee_fines:apply", "fee_fines:waive", "fee_discounts:read", "fee_discounts:apply", "fee_discounts:approve"];
const RESTRICTED = ["fees:manage", "fees:payment", "fee_fines:read", "fee_discounts:read"];

const SCHOOL_INVOICES = [
  { id: "i1", invoiceNo: "INV-0001", studentName: "Asha Rao", description: "Term 1 Tuition", amountDue: 15000, amountPaid: 7000, status: "partially_paid" },
  { id: "i2", invoiceNo: "INV-0002", studentName: "Vikram Nair", description: "Bus Fee", amountDue: 4000, amountPaid: 0, status: "pending" },
];
const COLLEGE_INVOICES = [
  { id: "c1", invoiceNo: "REG-INV-2001", studentName: "Nisha Verma", description: "Semester 5 Tuition", amountDue: 42000, amountPaid: 20000, status: "partially_paid" },
];
const DETAIL = {
  id: "i1", invoiceNo: "INV-0001", studentId: "s1", studentName: "Asha Rao", description: "Term 1 Tuition",
  amountDue: 15000, amountPaid: 7000, status: "partially_paid",
  payments: [{ id: "p1", amount: 7000, method: "cash", reference: "RCPT-1001", paidAt: "2026-07-05T09:00:00Z" }],
};
const BREAKDOWN = {
  studentId: "s1", base: 15000, fineTotal: 500, discountTotal: 0, outstanding: 8500,
  fines: [{ id: "f1", reason: "Late fee", days: 5, amount: 500, status: "applied" }],
  discounts: [{ id: "d1", reason: "Sibling discount", amount: 1000, status: "pending" }],
};

function mockFees(permissions: string[], invoices = SCHOOL_INVOICES, summary = { totalInvoiced: 19000, totalCollected: 6500, outstanding: 12500 }) {
  getMock.mockImplementation(async (path: string) => {
    if (path === "/auth/permissions") return { role: "admin", permissions };
    if (path.includes("/fees/summary")) return summary;
    if (path.includes("/fees/invoices/") && path.includes("/breakdown")) return BREAKDOWN;
    if (path.includes("/fees/invoices/")) return DETAIL;
    if (path.includes("/fees/invoices")) return { data: invoices, meta: { total: invoices.length, page: 1, limit: 50 } };
    if (path.includes("/fees/fine-rules")) return [{ id: "fr1", name: "Late fee" }];
    if (path.includes("/fees/discounts")) return [{ id: "dsc1", name: "Sibling" }];
    if (path.includes("/students")) return { data: [{ id: "s1", firstName: "Asha", lastName: "Rao", admissionNo: "ADM-1001" }], meta: { total: 1, page: 1, limit: 100 } };
    throw new Error(`unexpected api.get(${path})`);
  });
}

beforeEach(() => {
  getMock.mockReset(); postMock.mockReset();
  useSkinStore.setState({ active: false, resolved: true });
});
afterEach(cleanup);

describe("data parity", () => {
  it("renders school summary + invoice rows from the payload", async () => {
    mockFees(FULL);
    render(<FeesPage />);
    expect(await screen.findByText("INV-0001")).toBeTruthy();
    expect(screen.getByText("Asha Rao")).toBeTruthy();
    expect(screen.getByText("19,000")).toBeTruthy(); // total invoiced
    expect(screen.getByText("6,500")).toBeTruthy(); // collected
    expect(screen.getByText("partially paid")).toBeTruthy(); // status label
  });
  it("renders college invoice data (same layout)", async () => {
    mockFees(FULL, COLLEGE_INVOICES, { totalInvoiced: 42000, totalCollected: 20000, outstanding: 22000 });
    render(<FeesPage />);
    expect(await screen.findByText("REG-INV-2001")).toBeTruthy();
    expect(screen.getByText("Nisha Verma")).toBeTruthy();
  });
});

describe("request parity — only fees endpoints (+ picker + permissions)", () => {
  it("never calls an unexpected endpoint", async () => {
    mockFees(FULL);
    render(<FeesPage />);
    await screen.findByText("INV-0001");
    const ok = (p: string) =>
      p === "/auth/permissions" || p.startsWith("/fees/") || p.startsWith("/students");
    for (const c of getMock.mock.calls) expect(ok(String(c[0])), String(c[0])).toBe(true);
  });
});

describe("RBAC visibility — restricted hides adjustments controls, keeps invoice/payment actions", () => {
  it("full-perm shows Apply fine/discount + Waive + Approve", async () => {
    mockFees(FULL);
    render(<FeesPage />);
    await screen.findByText("INV-0001");
    fireEvent.click(screen.getAllByText("View payments")[0]);
    expect(await screen.findByText("Sibling discount")).toBeTruthy();
    expect(screen.getByText("Apply fine")).toBeTruthy();
    expect(screen.getByText("Apply discount")).toBeTruthy();
    expect(screen.getByText("Waive")).toBeTruthy();
    expect(screen.getByText("Approve")).toBeTruthy();
  });

  it("restricted hides Apply fine/discount + Waive + Approve, but keeps New invoice + Record payment", async () => {
    mockFees(RESTRICTED);
    render(<FeesPage />);
    await screen.findByText("INV-0001");
    // Invoice/payment actions remain (server-enforced; current behaviour).
    expect(screen.getByText("+ New invoice")).toBeTruthy();
    expect(screen.getAllByText("Record payment").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByText("View payments")[0]);
    expect(await screen.findByText("Sibling discount")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText("Apply fine")).toBeNull();
      expect(screen.queryByText("Apply discount")).toBeNull();
      expect(screen.queryByText("Waive")).toBeNull();
      expect(screen.queryByText("Approve")).toBeNull();
    });
  });
});

describe("Outstanding math + modal opens", () => {
  it("Record payment shows Outstanding = due − paid", async () => {
    mockFees(FULL);
    render(<FeesPage />);
    await screen.findByText("INV-0001");
    fireEvent.click(screen.getAllByText("Record payment")[0]);
    expect(await screen.findByText(/Record payment —/)).toBeTruthy();
    expect(screen.getByText("8,000")).toBeTruthy(); // 15000 − 7000
  });
  it("New invoice opens an empty form with the student picker", async () => {
    mockFees(FULL);
    render(<FeesPage />);
    await screen.findByText("INV-0001");
    fireEvent.click(screen.getByText("+ New invoice"));
    expect(await screen.findByText("New invoice")).toBeTruthy();
    expect(screen.getByText(/Asha Rao \(ADM-1001\)/)).toBeTruthy();
  });
});

describe("a11y markup — eligible-UI-v2-only (Decision 6)", () => {
  it("off-flag adds no caption/scope/aria (legacy byte-identical)", async () => {
    useSkinStore.setState({ active: false, resolved: true });
    mockFees(FULL);
    const { container } = render(<FeesPage />);
    await screen.findByText("INV-0001");
    expect(container.querySelector("caption")).toBeNull();
    expect(container.querySelector("th[scope]")).toBeNull();
    expect(screen.getAllByText("View payments")[0].getAttribute("aria-label")).toBeNull();
  });
  it("on-flag adds table scope/caption, filter + row-action aria", async () => {
    useSkinStore.setState({ active: true, resolved: true });
    mockFees(FULL);
    const { container } = render(<FeesPage />);
    await screen.findByText("INV-0001");
    expect(container.querySelector("caption")?.textContent).toBe("Invoices");
    expect(container.querySelectorAll("th[scope='col']").length).toBe(7);
    expect(screen.getByLabelText("Filter invoices by status")).toBeTruthy();
    expect(screen.getByLabelText("View payments — INV-0001")).toBeTruthy();
  });
});

describe("frozen-surface + dormancy — Fees CSS", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
  const feSelectors = selectors.filter((s) => s.includes(".fe-"));
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];

  it("defines Fees (`fe-*`) rules", () => {
    expect(feSelectors.length).toBeGreaterThan(0);
  });
  it("never applies a Fees style without a `.ui-v2` ancestor", () => {
    for (const s of feSelectors) expect(s.includes(".ui-v2"), `escapes scope: ${s}`).toBe(true);
  });
  it("uses NO glass (backdrop-filter) and NO gold on any `.fe-` surface", () => {
    for (const [, sel, body] of rules) {
      if (!sel.includes(".fe-")) continue;
      expect(/backdrop-filter/.test(body), `fe glass: ${sel.trim()}`).toBe(false);
      expect(body.includes("--c-gold"), `fe gold: ${sel.trim()}`).toBe(false);
    }
  });
  it("leaves the @media print (forced-light) block untouched by Fees", () => {
    const printBlock = css.slice(css.indexOf("@media print {"));
    expect(printBlock.includes("@media print {")).toBe(true);
    expect(printBlock.includes(".fe-")).toBe(false);
  });
});
