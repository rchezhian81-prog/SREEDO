// PR-T2.1 — the finer, assignable tenant job-roles.
//
// These layer on top of the five coarse tenant roles (admin/teacher/accountant/
// student/parent). A user carries a coarse `users.role` (unchanged, drives
// coarse authorize() checks + the fallback) plus an optional `users.job_role_key`
// (this registry). When set, permission resolution uses the job-role's key
// against role_permissions (+ per-tenant overrides); when null, it falls back to
// the coarse role — exactly today's behaviour. Mirrors the platform_role pattern.
//
// The 19 staff job-roles below + the two coarse portal roles (student, parent)
// are the 21 built-in tenant roles. Portal roles are NOT finer job-roles — they
// remain the coarse roles, so assigning a job_role_key is a staff-only concept.

import { TENANT_PERMISSION_GROUPS, type Applicability } from "./tenant-rbac.registry";

// group key -> its permission keys, for composing default job-role sets.
const GK: Record<string, string[]> = Object.fromEntries(
  TENANT_PERMISSION_GROUPS.map((grp) => [grp.key, grp.permissions.map((p) => p.key)])
);
/** All permission keys from the named registry groups (deduped). */
const g = (...groupKeys: string[]): string[] => [
  ...new Set(groupKeys.flatMap((k) => GK[k] ?? [])),
];
/** Every registry key. */
export const ALL_REGISTRY_KEYS: string[] = [
  ...new Set(TENANT_PERMISSION_GROUPS.flatMap((grp) => grp.permissions.map((p) => p.key))),
];
/** Every read-only key (for the auditor). */
const READ_ONLY_KEYS: string[] = ALL_REGISTRY_KEYS.filter((k) => k.endsWith(":read"));
/** The fees group minus the two most sensitive money capabilities. */
const FEES_OFFICER_KEYS: string[] = g("fees").filter(
  (k) => k !== "fees:reverse" && k !== "online_payments:refund"
);

export type BaseRole = "admin" | "teacher" | "accountant";

export interface JobRole {
  key: string;
  name: string;
  description: string;
  /** Coarse role set on the user when assigned — drives coarse authorize() + fallback. */
  baseRole: BaseRole;
  appliesTo: Applicability;
  /** Default effective permission set (registry keys) seeded into role_permissions. */
  permissions: string[];
}

const uniq = (...lists: string[][]): string[] => [...new Set(lists.flat())];

const RAW_JOB_ROLES: JobRole[] = [
  {
    key: "owner_management",
    name: "Institution Owner / Management",
    description: "Full tenant access — settings, roles, users, and every module.",
    baseRole: "admin",
    appliesTo: "both",
    permissions: ALL_REGISTRY_KEYS,
  },
  {
    key: "principal",
    name: "Principal / Head of Institution",
    description: "Broad academic oversight; can view fees and reports. No fee reversal, RBAC or user management by default.",
    baseRole: "admin",
    appliesTo: "both",
    permissions: uniq(
      g("students", "staff", "attendance", "exams", "timetable", "reports",
        "academic_setup", "admissions", "communication", "documents", "calendar",
        "homework", "discipline", "ai", "college_academics", "ptm", "student_leave"),
      ["fee_categories:read", "fee_schedules:read", "fee_fines:read",
       "fee_discounts:read", "online_payments:read", "fee_receipts:download",
       "data_io:read", "data_io:export"]
    ),
  },
  {
    key: "admin_officer",
    name: "Admin Officer",
    description: "Students, admissions, academic setup, documents and front office. Limited finance by default.",
    baseRole: "admin",
    appliesTo: "both",
    permissions: uniq(
      g("students", "admissions", "academic_setup", "documents", "front_office",
        "calendar", "communication", "data_io"),
      ["timetable:read"]
    ),
  },
  {
    key: "academic_coordinator",
    name: "Academic Coordinator",
    description: "Academic setup, timetable, attendance, exams and reports.",
    baseRole: "admin",
    appliesTo: "both",
    permissions: g("academic_setup", "timetable", "attendance", "exams", "reports",
      "homework", "college_academics", "ptm", "student_leave"),
  },
  {
    key: "admission_officer",
    name: "Admission Officer",
    description: "Admissions and enquiries, student creation, and documents.",
    baseRole: "admin",
    appliesTo: "both",
    permissions: uniq(
      g("admissions"),
      ["students:create", "students:update", "documents:read", "documents:upload",
       "communication:read", "communication:send"]
    ),
  },
  {
    key: "fees_officer",
    name: "Fees / Accounts Officer",
    description: "Fees, receipts, payments, dues and finance reports. No fee reversal or academic marks by default.",
    baseRole: "accountant",
    appliesTo: "both",
    permissions: uniq(FEES_OFFICER_KEYS, ["reports:read"]),
  },
  {
    key: "exam_controller",
    name: "Exam Controller",
    description: "Exams, marks, results and report cards. No fees or RBAC by default.",
    baseRole: "teacher",
    appliesTo: "both",
    permissions: uniq(g("exams"), ["timetable:read"]),
  },
  {
    key: "attendance_officer",
    name: "Attendance Officer",
    description: "Attendance marking, editing and reports.",
    baseRole: "teacher",
    appliesTo: "both",
    permissions: uniq(g("student_leave"), ["attendance:mark", "reports:read"]),
  },
  {
    key: "timetable_coordinator",
    name: "Timetable Coordinator",
    description: "Timetable management and staff-workload views.",
    baseRole: "admin",
    appliesTo: "both",
    permissions: uniq(g("timetable"), ["staff_attendance:read"]),
  },
  {
    key: "hr_admin",
    name: "HR / Staff Admin",
    description: "Staff and teacher profiles, staff attendance, leave and payroll.",
    baseRole: "admin",
    appliesTo: "both",
    permissions: g("staff"),
  },
  {
    key: "hod",
    name: "Department Head / HOD",
    description: "Department, program and semester academic controls (college).",
    baseRole: "teacher",
    appliesTo: "college",
    permissions: uniq(g("college_academics"),
      ["exams:enter_marks", "timetable:read", "attendance:mark", "homework:read"]),
  },
  {
    key: "class_teacher",
    name: "Class Teacher",
    description: "Own class: attendance, homework, basic reports and parent communication.",
    baseRole: "teacher",
    appliesTo: "school",
    permissions: uniq(g("homework", "ptm", "student_leave"),
      ["attendance:mark", "communication:read", "communication:send", "reports:read"]),
  },
  {
    key: "subject_teacher",
    name: "Subject Teacher",
    description: "Own subject: attendance, marks and homework.",
    baseRole: "teacher",
    appliesTo: "both",
    permissions: uniq(g("homework"), ["attendance:mark", "exams:enter_marks"]),
  },
  {
    key: "front_office",
    name: "Front Office / Reception",
    description: "Enquiries, visitors, basic student lookup and communication intake.",
    baseRole: "admin",
    appliesTo: "both",
    permissions: uniq(g("front_office"),
      ["admissions:read", "admissions:create", "communication:read",
       "communication:send", "calendar:manage"]),
  },
  {
    key: "librarian",
    name: "Librarian",
    description: "Library management only.",
    baseRole: "accountant",
    appliesTo: "both",
    permissions: g("library"),
  },
  {
    key: "transport_manager",
    name: "Transport Manager",
    description: "Transport management only.",
    baseRole: "accountant",
    appliesTo: "both",
    permissions: g("transport"),
  },
  {
    key: "hostel_warden",
    name: "Hostel Warden",
    description: "Hostel management only.",
    baseRole: "accountant",
    appliesTo: "both",
    permissions: g("hostel"),
  },
  {
    key: "inventory_manager",
    name: "Inventory Manager",
    description: "Inventory management only.",
    baseRole: "accountant",
    appliesTo: "both",
    permissions: g("inventory"),
  },
  {
    key: "auditor",
    name: "Read-only Auditor",
    description: "View-only across modules. No writes; exports only if explicitly granted.",
    baseRole: "accountant",
    appliesTo: "both",
    permissions: uniq(READ_ONLY_KEYS, ["reports:read", "reports:center:read"]),
  },
];

// Namespace job-role keys with `jr_` so they can NEVER collide with a coarse
// tenant role (admin/teacher/…) or a platform sub-role (owner/auditor/…) in the
// shared global role_permissions table. role_permissions rows, users.job_role_key
// and tenant_roles.key all use the prefixed key; only the display `name` is
// human-facing.
export const JOB_ROLE_PREFIX = "jr_";
export const JOB_ROLES: JobRole[] = RAW_JOB_ROLES.map((r) => ({
  ...r,
  key: `${JOB_ROLE_PREFIX}${r.key}`,
}));

export const JOB_ROLE_KEYS = JOB_ROLES.map((r) => r.key);
export const JOB_ROLE_BY_KEY: Record<string, JobRole> = Object.fromEntries(
  JOB_ROLES.map((r) => [r.key, r])
);
/** True when a key is a job-role key (vs a coarse role). */
export const isJobRoleKey = (key: string | null | undefined): boolean =>
  !!key && key.startsWith(JOB_ROLE_PREFIX);
