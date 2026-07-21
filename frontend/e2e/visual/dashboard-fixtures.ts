import type { Page } from "@playwright/test";

/**
 * PR-UI5 — deterministic, non-personal Dashboard fixtures.
 *
 * Three synthetic staff personas — a School administrator, a College
 * administrator, and a fees-less staff member — each with a fixed session,
 * permission set and a fully hard-coded `/dashboard/summary` payload (already
 * RBAC-shaped exactly as the server returns it). NO production or real personal
 * data appears here.
 *
 * The fees-less persona is the RBAC proof: its summary carries `finance: null`,
 * so the money figures are ABSENT from the payload (not merely hidden with CSS),
 * `/auth/permissions` omits `fees:read`, and the overdue-fees alert (gated on
 * `fees:read`) is gone — the Fees panel therefore renders its honest
 * "no access" empty state and the two-column row still closes naturally.
 */

export type PersonaKey = "schoolAdmin" | "collegeAdmin" | "feesLess";

const FULL_PERMS = [
  "students:read", "fees:read", "attendance:read", "exams:read", "staff:read",
  "timetable:read", "communication:read", "reports:read", "transport:read",
  "library:read", "hostel:read", "settings:read", "academics:read",
  "admissions:read", "academic_years:manage",
];
// Fees-less: the normal non-finance reads needed to render the Dashboard, with
// `fees:read` explicitly removed.
const NON_FINANCE_PERMS = FULL_PERMS.filter((p) => p !== "fees:read");

const ENABLED_MODULES = [
  "students", "fees", "attendance", "exams", "staff", "timetable", "communication",
  "reports", "transport", "library", "hostel", "academics", "admissions",
];

const SCHOOL_ANNS = [
  { id: "a1", title: "Annual Day rehearsals begin Monday", publishedAt: "2026-07-15T09:00:00Z", isPinned: true },
  { id: "a2", title: "Library reopens after annual inventory", publishedAt: "2026-07-14T09:00:00Z", isPinned: false },
  { id: "a3", title: "Parent–teacher meeting slots now open", publishedAt: "2026-07-12T09:00:00Z", isPinned: false },
];
const COLLEGE_ANNS = [
  { id: "c1", title: "Semester 5 registration closes Friday", publishedAt: "2026-07-15T09:00:00Z", isPinned: true },
  { id: "c2", title: "Placement drive scheduled for 28 July", publishedAt: "2026-07-14T09:00:00Z", isPinned: false },
  { id: "c3", title: "Library extended hours during exams", publishedAt: "2026-07-11T09:00:00Z", isPinned: false },
];

const SCHOOL_ACADEMIC = {
  classes: 24, sections: 58, subjects: 32, departments: 0, programs: 0,
  semesters: 0, batches: 0, activeStudents: 1280, activeStaff: 96,
};
const SCHOOL_INSTITUTION = {
  name: "Demo Public School", type: "school", code: "DPS", isActive: true,
  currentAcademicYear: { id: "yr1", name: "2026-27" },
};
const SCHOOL_ATTENDANCE = { marked: 1180, present: 1085, rate: 1085 / 1180 };

const SCHOOL_SUMMARY_FULL = {
  institution: SCHOOL_INSTITUTION,
  academic: SCHOOL_ACADEMIC,
  operations: {
    attendanceToday: SCHOOL_ATTENDANCE,
    pendingAdmissions: 14, upcomingExams: 3, homeworkDue: 12, upcomingEvents: 5,
  },
  finance: {
    pendingInvoices: 42, totalInvoiced: 5400000, totalCollected: 4870000,
    outstanding: 530000, overdueInvoices: 9, collectedToday: 128500,
  },
  communication: { recentAnnouncements: SCHOOL_ANNS, failedComms: 0 },
  needsAttention: [{ key: "overdue_fees", severity: "warning", count: 9 }],
};

const COLLEGE_SUMMARY_FULL = {
  institution: {
    name: "Demo Institute of Technology", type: "college", code: "DIT",
    isActive: true, currentAcademicYear: { id: "yr1", name: "2026-27" },
  },
  academic: {
    classes: 0, sections: 0, subjects: 48, departments: 6, programs: 12,
    semesters: 8, batches: 22, activeStudents: 2140, activeStaff: 138,
  },
  operations: {
    attendanceToday: { marked: 1900, present: 1748, rate: 1748 / 1900 },
    pendingAdmissions: 31, upcomingExams: 5, homeworkDue: 7, upcomingEvents: 9,
  },
  finance: {
    pendingInvoices: 66, totalInvoiced: 18600000, totalCollected: 17200000,
    outstanding: 1400000, overdueInvoices: 15, collectedToday: 342000,
  },
  communication: { recentAnnouncements: COLLEGE_ANNS, failedComms: 0 },
  needsAttention: [{ key: "overdue_fees", severity: "warning", count: 15 }],
};

// Same School institution, but finance is ABSENT (the server nulls it for a
// caller without `fees:read`) and the fees-gated alert is gone. Admissions +
// communication remain because those reads are retained.
const SCHOOL_SUMMARY_NO_FINANCE = {
  institution: SCHOOL_INSTITUTION,
  academic: SCHOOL_ACADEMIC,
  operations: {
    attendanceToday: SCHOOL_ATTENDANCE,
    pendingAdmissions: 14, upcomingExams: 3, homeworkDue: 12, upcomingEvents: 5,
  },
  finance: null,
  communication: { recentAnnouncements: SCHOOL_ANNS, failedComms: 0 },
  needsAttention: [],
};

type Persona = {
  mode: "school" | "college";
  user: {
    id: string; email: string; fullName: string; role: string;
    institutionId: string; institutionName: string; institutionType: string;
  };
  permissions: string[];
  summary: unknown;
};

export const PERSONAS: Record<PersonaKey, Persona> = {
  schoolAdmin: {
    mode: "school",
    user: {
      id: "00000000-0000-0000-0000-000000000001", email: "school.admin@example.test",
      fullName: "Demo Admin", role: "admin",
      institutionId: "00000000-0000-0000-0000-0000000000aa",
      institutionName: "Demo Public School", institutionType: "school",
    },
    permissions: FULL_PERMS,
    summary: SCHOOL_SUMMARY_FULL,
  },
  collegeAdmin: {
    mode: "college",
    user: {
      id: "00000000-0000-0000-0000-000000000002", email: "college.admin@example.test",
      fullName: "Demo Admin", role: "admin",
      institutionId: "00000000-0000-0000-0000-0000000000bb",
      institutionName: "Demo Institute of Technology", institutionType: "college",
    },
    permissions: FULL_PERMS,
    summary: COLLEGE_SUMMARY_FULL,
  },
  feesLess: {
    mode: "school",
    user: {
      id: "00000000-0000-0000-0000-000000000003", email: "limited.staff@example.test",
      fullName: "Demo Staff", role: "staff",
      institutionId: "00000000-0000-0000-0000-0000000000aa",
      institutionName: "Demo Public School", institutionType: "school",
    },
    permissions: NON_FINANCE_PERMS,
    summary: SCHOOL_SUMMARY_NO_FINANCE,
  },
};

/** Seed the persisted session, explicit theme, and campus mode before app JS. */
export async function seedSession(page: Page, opts: { persona: PersonaKey; dark: boolean }) {
  const p = PERSONAS[opts.persona];
  await page.addInitScript(
    ([user, mode, dark]) => {
      localStorage.setItem(
        "sreedo-auth",
        JSON.stringify({
          state: { user, accessToken: "visual-fixture-token", refreshToken: "visual-fixture-refresh", support: null },
          version: 0,
        })
      );
      // Campus mode drives the terminology engine (School vs College nouns).
      localStorage.setItem(
        "sreedo-mode",
        JSON.stringify({ state: { mode, hasChosen: true }, version: 0 })
      );
      localStorage.setItem("gocampus-theme", dark ? "dark" : "light");
    },
    [p.user, p.mode, opts.dark] as const
  );
}

/** Stub every shell + Dashboard API call; `uiV2` drives the audited tenant flag. */
export async function installDashboardMocks(page: Page, opts: { persona: PersonaKey; uiV2: boolean }) {
  const p = PERSONAS[opts.persona];
  await page.route("**/api/v1/**", async (route) => {
    const url = route.request().url();
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

    if (url.includes("/auth/me"))
      return json({
        ...p.user,
        enabledModules: ENABLED_MODULES,
        twoFactorEnabled: false,
        uiV2Enabled: opts.uiV2,
      });
    if (url.includes("/auth/permissions")) return json({ role: p.user.role, permissions: p.permissions });
    if (url.includes("/dashboard/summary")) return json(p.summary);
    if (url.includes("/branding"))
      return json({ displayName: p.user.institutionName, logoUrl: null, primaryColor: null, tagline: "Excellence in Education" });
    if (url.includes("/academic-years")) return json([{ id: "yr1", name: "2026-27", isCurrent: true }]);
    if (url.includes("/communication/inbox/unread-count")) return json({ count: 0 });
    if (url.includes("/search")) return json({ results: [] });
    // Anything else must NOT be requested by the Dashboard — abort so a stray
    // call can never leak data or make the screenshot non-deterministic.
    return route.abort();
  });
}
