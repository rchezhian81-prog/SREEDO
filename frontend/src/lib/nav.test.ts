import { describe, it, expect } from "vitest";
import {
  tenantGroups,
  filterNavGroups,
  flattenItems,
  defaultOpenGroups,
  splitFold,
  FOLD_LIMIT,
  QUICK_ACTIONS,
  type NavItem,
} from "./nav";
import type { TermSet } from "@/lib/terms";

// PX2 is presentation-only: this file locks the registry so any change to an
// href, perm, moduleKey or adminOnly flag fails loudly in CI.

const gate = (i: NavItem) =>
  `${i.href}|perm=${i.perm ?? ""}|mod=${i.moduleKey ?? ""}|admin=${i.adminOnly ? 1 : 0}`;

const SHARED_GATES = [
  "/dashboard|perm=|mod=|admin=0",
  "/get-started|perm=|mod=|admin=1",
  "/help|perm=tenant_help:read|mod=|admin=0",
  "/analytics|perm=|mod=|admin=1",
  "/ai-insights|perm=ai:read|mod=|admin=0",
  "/copilot|perm=ai:copilot|mod=|admin=0",
  "/students|perm=students:read|mod=students|admin=0",
  "/admissions|perm=|mod=admissions|admin=1",
  "/id-cards|perm=id_cards:read|mod=|admin=0",
  "/transfer-certificates|perm=|mod=|admin=1",
  "/documents|perm=documents:read|mod=documents|admin=0",
  "/alumni|perm=|mod=|admin=1",
  "/attendance|perm=|mod=attendance|admin=0",
  "/period-attendance|perm=|mod=attendance|admin=0",
  "/homework|perm=homework:read|mod=|admin=0",
  "/leave|perm=leave:read|mod=|admin=0",
  "/student-leave|perm=student_leave:read|mod=|admin=0",
  "/disciplinary|perm=|mod=|admin=1",
  "/study-materials|perm=|mod=|admin=0",
  "/live-classes|perm=|mod=|admin=0",
  "/quizzes|perm=|mod=|admin=0",
  "/biometric|perm=|mod=|admin=1",
  "/fees|perm=fees:read|mod=fees|admin=0",
  "/fees/setup|perm=|mod=|admin=1",
  "/fees/refunds|perm=|mod=|admin=1",
  "/online-payments|perm=|mod=|admin=1",
  "/accounting|perm=|mod=|admin=1",
  "/teachers|perm=|mod=staff|admin=0",
  "/staff/directory|perm=teachers:manage|mod=staff|admin=0",
  "/staff|perm=staff_attendance:read|mod=|admin=0",
  "/payroll|perm=|mod=payroll|admin=1",
  "/library|perm=library:read|mod=library|admin=0",
  "/transport|perm=transport:read|mod=transport|admin=0",
  "/hostel|perm=hostel:read|mod=hostel|admin=0",
  "/inventory|perm=inventory:read|mod=inventory|admin=0",
  "/front-office|perm=front_office:read|mod=|admin=0",
  "/infirmary|perm=|mod=|admin=1",
  "/cafeteria|perm=|mod=|admin=1",
  "/gallery|perm=|mod=|admin=1",
  "/announcements|perm=|mod=|admin=0",
  "/communication|perm=communication:read|mod=communication|admin=0",
  "/messaging|perm=|mod=|admin=0",
  "/ptm|perm=ptm:read|mod=|admin=0",
  "/polls|perm=|mod=|admin=0",
  "/reports-hub|perm=reports:read|mod=|admin=0",
  "/settings|perm=|mod=|admin=1",
  "/settings/rbac|perm=tenant_rbac:read|mod=|admin=0",
  "/users|perm=|mod=|admin=1",
  "/data-io|perm=data_io:read|mod=|admin=0",
  "/branding|perm=|mod=|admin=1",
  "/integrations|perm=|mod=|admin=1",
  "/jobs|perm=|mod=|admin=1",
  "/activity|perm=|mod=|admin=1",
  "/security|perm=|mod=|admin=0",
];

const SCHOOL_ONLY = [
  "/classes|perm=|mod=|admin=0",
  "/timetable|perm=timetable:read|mod=timetable|admin=0",
  "/timetable/generate|perm=|mod=timetable|admin=1",
  "/calendar|perm=|mod=|admin=0",
  "/exams|perm=|mod=exams|admin=0",
  "/reports|perm=reports:read|mod=reports|admin=0",
];

const COLLEGE_ONLY = [
  "/college|perm=college:read|mod=|admin=0",
  "/college/departments|perm=departments:read|mod=|admin=0",
  "/college/programs|perm=programs:read|mod=|admin=0",
  "/college/semesters|perm=semesters:read|mod=|admin=0",
  "/college/subjects|perm=|mod=|admin=0",
  "/college/enrollments|perm=|mod=|admin=0",
  "/timetable|perm=timetable:read|mod=timetable|admin=0",
  "/timetable/generate|perm=|mod=timetable|admin=1",
  "/calendar|perm=|mod=|admin=0",
  "/exams|perm=|mod=exams|admin=0",
  "/college/results|perm=|mod=|admin=0",
  "/reports|perm=reports:read|mod=reports|admin=0",
];

describe("registry lock — hrefs/perms/moduleKeys byte-identical to pre-PX2", () => {
  it("school mode carries exactly the expected gates", () => {
    const got = flattenItems(tenantGroups("school")).map(gate).sort();
    expect(got).toEqual([...SHARED_GATES, ...SCHOOL_ONLY].sort());
  });

  it("college mode carries exactly the expected gates", () => {
    const got = flattenItems(tenantGroups("college")).map(gate).sort();
    expect(got).toEqual([...SHARED_GATES, ...COLLEGE_ONLY].sort());
  });

  it("keeps the eleven-section IA", () => {
    expect(tenantGroups("school").map((g) => g.title)).toEqual([
      "Overview",
      "Academic Setup",
      "Students & Admissions",
      "Attendance & Daily Work",
      "Fees & Accounts",
      "Exams & Results",
      "Staff & HR",
      "Operations",
      "Communication",
      "Reports",
      "Administration",
    ]);
  });
});

const TERM = { subjectPlural: "Subjects", reportCard: "Report Card", teachers: "Teachers" } as unknown as TermSet;
const allow = () => true;

describe("filterNavGroups — the sidebar's exact gating, shared with the palette", () => {
  it("hides adminOnly items from non-admins and keeps them for admins", () => {
    const groups = tenantGroups("school");
    const admin = flattenItems(filterNavGroups(groups, { isSuper: false, isAdmin: true, enabledModules: null, can: allow, term: TERM }));
    const staff = flattenItems(filterNavGroups(groups, { isSuper: false, isAdmin: false, enabledModules: null, can: allow, term: TERM }));
    expect(admin.some((i) => i.href === "/settings")).toBe(true);
    expect(staff.some((i) => i.href === "/settings")).toBe(false);
    expect(staff.some((i) => i.href === "/dashboard")).toBe(true);
  });

  it("applies the effective-permission gate", () => {
    const can = (p?: string) => !p || p === "students:read";
    const items = flattenItems(
      filterNavGroups(tenantGroups("school"), { isSuper: false, isAdmin: false, enabledModules: null, can, term: TERM })
    );
    expect(items.some((i) => i.href === "/students")).toBe(true);
    expect(items.some((i) => i.href === "/fees")).toBe(false);
  });

  it("applies the enabled-modules gate and drops empty groups", () => {
    const filtered = filterNavGroups(tenantGroups("school"), {
      isSuper: false,
      isAdmin: false,
      enabledModules: ["students"],
      can: (p?: string) => !p,
      term: TERM,
    });
    const items = flattenItems(filtered);
    expect(items.some((i) => i.href === "/attendance")).toBe(false); // module off
    expect(items.some((i) => i.href === "/dashboard")).toBe(true); // untagged stays
    expect(filtered.every((g) => g.items.length > 0)).toBe(true);
  });
});

describe("nav diet", () => {
  it("opens the audited per-role defaults", () => {
    expect([...defaultOpenGroups("teacher")]).toEqual(["Overview", "Attendance & Daily Work", "Exams & Results"]);
    expect([...defaultOpenGroups("accountant")]).toEqual(["Overview", "Fees & Accounts"]);
    expect(defaultOpenGroups("admin").has("Overview")).toBe(true);
    expect([...defaultOpenGroups(undefined)]).toEqual(["Overview"]);
  });

  it("folds long groups to FOLD_LIMIT but never hides the active route", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ href: `/x${i}`, label: `X${i}`, icon: "grid" }) as NavItem);
    const folded = splitFold(items, null, false);
    expect(folded.visible).toHaveLength(FOLD_LIMIT);
    expect(folded.foldedCount).toBe(3);
    // Active route beyond the fold → group renders unfolded.
    expect(splitFold(items, "/x9", false).visible).toHaveLength(10);
    // Explicitly expanded → everything visible.
    expect(splitFold(items, null, true).visible).toHaveLength(10);
  });
});

describe("quick actions are deep-links into real registry pages only", () => {
  it("every action href exists in the registry (both modes) — nothing invented", () => {
    const hrefs = new Set([
      ...flattenItems(tenantGroups("school")).map((i) => i.href),
      ...flattenItems(tenantGroups("college")).map((i) => i.href),
    ]);
    for (const a of QUICK_ACTIONS) expect(hrefs.has(a.href)).toBe(true);
  });
});
