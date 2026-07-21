// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * PR-UI5 — tenant staff Dashboard. These tests pin the contracts jsdom can verify
 * directly, independent of pixels (which the Playwright matrix owns):
 *   1. KPI/data parity — rendered values equal the `/dashboard/summary` payload,
 *      byte-for-byte, for School and College.
 *   2. RBAC — a fees-less caller's summary has `finance: null`, so the money data
 *      is ABSENT (not CSS-hidden): the Fees panel shows its empty state and NO ₹
 *      appears anywhere. The page requests ONLY `/dashboard/summary` (+ the
 *      permissions call) — never `/fees`.
 *   3. `upcomingEvents` stays unrendered.
 *   4. Frozen-surface + dormancy — EVERY `.db-*` rule is `.ui-v2`-scoped, glass
 *      (blur) is dark-only, and gold is a pinned-announcement accent only.
 */

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock("@/lib/api", () => ({
  api: { get: getMock },
  ApiError: class ApiError extends Error {},
}));

import DashboardPage from "./page";
import { useAuthStore } from "@/stores/auth-store";
import { useModeStore } from "@/stores/mode-store";

const SCHOOL_SUMMARY = {
  institution: { name: "Demo Public School", type: "school", code: "DPS", isActive: true, currentAcademicYear: { id: "yr1", name: "2026-27" } },
  academic: { classes: 24, sections: 58, subjects: 32, departments: 0, programs: 0, semesters: 0, batches: 0, activeStudents: 1280, activeStaff: 96 },
  operations: { attendanceToday: { marked: 1180, present: 1085, rate: 1085 / 1180 }, pendingAdmissions: 14, upcomingExams: 3, homeworkDue: 12, upcomingEvents: 5 },
  finance: { pendingInvoices: 42, totalInvoiced: 5400000, totalCollected: 4870000, outstanding: 530000, overdueInvoices: 9, collectedToday: 128500 },
  communication: { recentAnnouncements: [{ id: "a1", title: "Annual Day rehearsals begin Monday", publishedAt: "2026-07-15T09:00:00Z", isPinned: true }], failedComms: 0 },
  needsAttention: [{ key: "overdue_fees", severity: "warning", count: 9 }],
};

const COLLEGE_SUMMARY = {
  institution: { name: "Demo Institute of Technology", type: "college", code: "DIT", isActive: true, currentAcademicYear: { id: "yr1", name: "2026-27" } },
  academic: { classes: 0, sections: 0, subjects: 48, departments: 6, programs: 12, semesters: 8, batches: 22, activeStudents: 2140, activeStaff: 138 },
  operations: { attendanceToday: { marked: 1900, present: 1748, rate: 1748 / 1900 }, pendingAdmissions: 31, upcomingExams: 5, homeworkDue: 7, upcomingEvents: 9 },
  finance: { pendingInvoices: 66, totalInvoiced: 18600000, totalCollected: 17200000, outstanding: 1400000, overdueInvoices: 15, collectedToday: 342000 },
  communication: { recentAnnouncements: [{ id: "c1", title: "Semester 5 registration closes Friday", publishedAt: "2026-07-15T09:00:00Z", isPinned: true }], failedComms: 0 },
  needsAttention: [{ key: "overdue_fees", severity: "warning", count: 15 }],
};

const FEES_LESS_SUMMARY = { ...SCHOOL_SUMMARY, finance: null, needsAttention: [] };

const FULL_PERMS = ["students:read", "fees:read", "admissions:read", "communication:read", "academic_years:manage"];
const NON_FINANCE_PERMS = ["students:read", "admissions:read", "communication:read"];

function mockApi(summary: unknown, permissions: string[]) {
  getMock.mockImplementation(async (path: string) => {
    if (path === "/dashboard/summary") return summary;
    if (path === "/auth/permissions") return { role: "admin", permissions };
    throw new Error(`unexpected api.get(${path})`);
  });
}

beforeEach(() => {
  getMock.mockReset();
  useAuthStore.setState({ user: { fullName: "Demo Admin" } as never });
});
afterEach(() => {
  cleanup();
  useModeStore.setState({ mode: "school", hasChosen: false });
});

describe("KPI/data parity — School", () => {
  beforeEach(() => useModeStore.setState({ mode: "school", hasChosen: true }));

  it("renders the summary values exactly, with School terminology", async () => {
    mockApi(SCHOOL_SUMMARY, FULL_PERMS);
    const { container } = render(<DashboardPage />);
    // Active students (en-IN grouping) + attendance rate (round(1085/1180*100)=92).
    expect(await screen.findByText("1,280")).toBeTruthy();
    expect(screen.getByText("92%")).toBeTruthy();
    // School nouns present; College nouns absent.
    expect(screen.getByText("Classes")).toBeTruthy();
    expect(screen.queryByText("Programs")).toBeNull();
    // Finance figures present (fees:read) — ₹ collected today (en-IN) = ₹1,28,500.
    expect(screen.getByText("₹1,28,500")).toBeTruthy();
    expect(screen.getByText("Collected today")).toBeTruthy();
    // upcomingEvents is in the payload but never surfaced.
    expect(screen.queryByText(/upcoming events/i)).toBeNull();
    expect(container.textContent).not.toContain("Upcoming Events");
  });
});

describe("KPI/data parity — College", () => {
  beforeEach(() => useModeStore.setState({ mode: "college", hasChosen: true }));

  it("renders College terminology + counts, never the School nouns", async () => {
    mockApi(COLLEGE_SUMMARY, FULL_PERMS);
    render(<DashboardPage />);
    expect(await screen.findByText("2,140")).toBeTruthy(); // active students
    expect(screen.getByText("Programs")).toBeTruthy();
    expect(screen.getByText("Courses")).toBeTruthy();
    expect(screen.getByText("Faculty")).toBeTruthy();
    expect(screen.queryByText("Classes")).toBeNull();
  });
});

describe("RBAC — fees-less staff: finance ABSENT, no ₹, no /fees request", () => {
  beforeEach(() => useModeStore.setState({ mode: "school", hasChosen: true }));

  it("shows the honest no-access empty state and leaks no money data", async () => {
    mockApi(FEES_LESS_SUMMARY, NON_FINANCE_PERMS);
    const { container } = render(<DashboardPage />);
    expect(await screen.findByText("You don't have access to fee figures")).toBeTruthy();
    // No rupee value anywhere — the money data is absent from the payload.
    expect(container.textContent).not.toContain("₹");
    // Non-finance content still renders (layout closes naturally).
    expect(screen.getByText("Active Students")).toBeTruthy();
    expect(screen.getByText("Recent announcements")).toBeTruthy();
  });

  it("requests only /dashboard/summary (+ permissions) — never /fees", async () => {
    mockApi(FEES_LESS_SUMMARY, NON_FINANCE_PERMS);
    render(<DashboardPage />);
    await screen.findByText("You don't have access to fee figures");
    const paths = getMock.mock.calls.map((c) => String(c[0]));
    expect(paths).toContain("/dashboard/summary");
    expect(paths.every((p) => p === "/dashboard/summary" || p === "/auth/permissions")).toBe(true);
    expect(paths.some((p) => p.includes("/fees"))).toBe(false);
  });
});

describe("frozen-surface + dormancy — every Dashboard rule is `.ui-v2`-scoped", () => {
  // vitest runs from the frontend package root; globals.css lives under src/app.
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
  const dbSelectors = selectors.filter((s) => s.includes(".db-"));
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];

  it("actually defines Dashboard (`db-*`) rules", () => {
    expect(dbSelectors.length).toBeGreaterThan(0);
  });

  it("never applies a Dashboard style without a `.ui-v2` ancestor (legacy/super-admin/portal inert)", () => {
    for (const sel of dbSelectors) {
      expect(sel.includes(".ui-v2"), `db selector escapes .ui-v2 scope: "${sel}"`).toBe(true);
    }
  });

  it("frosts (backdrop blur) ONLY under `.ui-v2.dark` — light + off-flag stay solid", () => {
    for (const [, sel, body] of rules) {
      if (sel.includes(".db-") && /backdrop-filter:\s*blur/.test(body)) {
        expect(sel.includes(".ui-v2.dark"), `db glass escapes dark scope: "${sel.trim()}"`).toBe(true);
      }
    }
  });

  it("uses gold ONLY as the pinned-announcement accent (never a status colour)", () => {
    const goldDb = rules.filter(([, sel, body]) => sel.includes(".db-") && body.includes("--c-gold"));
    expect(goldDb.length).toBeGreaterThan(0);
    for (const [, sel] of goldDb) {
      expect(sel.includes(".db-ann--pinned")).toBe(true);
      expect(sel.includes(".ui-v2")).toBe(true);
    }
  });
});
