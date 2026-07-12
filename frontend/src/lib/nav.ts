import type { IconName } from "@/components/icons";
import type { CampusMode } from "@/stores/mode-store";
import type { TermSet } from "@/lib/terms";

// PR-PX2 — the tenant nav registry, moved verbatim from (dashboard)/layout.tsx
// so the sidebar and the command palette share one permission-truthful source.
// IA v2 is presentation only: every href, perm, moduleKey and adminOnly flag is
// byte-identical to the pre-PX2 registry (locked by nav.test.ts).

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  adminOnly?: boolean;
  // When set, the item is hidden if the tenant has an explicit enabled-modules
  // list that does not include this key. Untagged items are always shown.
  moduleKey?: string;
  // The effective permission required to see this item. Untagged items always
  // show; owners/admins hold every permission so keep them all. Used by both the
  // super-admin nav and (PR-T2) the tenant nav for per-tenant role-aware hiding.
  perm?: string;
  // Label that varies by School/College — resolved from useTerms() in the
  // component (module-level data can't call the hook).
  termLabel?: (t: TermSet) => string;
};

export type NavGroup = { title?: string; items: NavItem[] };

// Tenant sidebar organised into a stable information architecture (PR-T4) — the
// flat ~60-item list is grouped into eleven sections. Original per-item RBAC
// gates are preserved; admin-sensitive items that previously showed to any staff
// role now carry `adminOnly`. Reports (run / build / schedule) collapse into one
// hub entry; the exam "report cards" page moves under Exams & Results.
export function tenantGroups(mode: CampusMode): NavGroup[] {
  const isCollege = mode === "college";
  const academic: NavItem[] = isCollege
    ? [
        { href: "/college", label: "College Home", icon: "building", perm: "college:read" },
        { href: "/college/departments", label: "Departments", icon: "network", perm: "departments:read" },
        { href: "/college/programs", label: "Programs", icon: "layers", perm: "programs:read" },
        { href: "/college/semesters", label: "Semesters", icon: "calendar", perm: "semesters:read" },
        { href: "/college/subjects", label: "Subjects", termLabel: (t) => t.subjectPlural, icon: "bookOpen" },
        { href: "/college/enrollments", label: "Enrollments", icon: "userPlus" },
        { href: "/timetable", label: "Timetable", icon: "calendar", moduleKey: "timetable", perm: "timetable:read" },
        { href: "/timetable/generate", label: "Auto Timetable", icon: "sparkles", adminOnly: true, moduleKey: "timetable" },
        { href: "/calendar", label: "Calendar", icon: "calendar" },
      ]
    : [
        { href: "/classes", label: "Classes", icon: "school" },
        { href: "/timetable", label: "Timetable", icon: "calendar", moduleKey: "timetable", perm: "timetable:read" },
        { href: "/timetable/generate", label: "Auto Timetable", icon: "sparkles", adminOnly: true, moduleKey: "timetable" },
        { href: "/calendar", label: "Calendar", icon: "calendar" },
      ];
  const examsResults: NavItem[] = [
    { href: "/exams", label: "Exams", icon: "file", moduleKey: "exams" },
    ...(isCollege
      ? [{ href: "/college/results", label: "Results", icon: "clipboard" } as NavItem]
      : []),
    // Formerly the mislabelled "/reports" nav item — it is the report-card/grade
    // page, so it lives under results with a terminology-aware label.
    { href: "/reports", label: "Report Cards", termLabel: (t) => `${t.reportCard}s`, icon: "clipboard", moduleKey: "reports", perm: "reports:read" },
  ];
  return [
    {
      title: "Overview",
      items: [
        { href: "/dashboard", label: "Dashboard", icon: "grid" },
        { href: "/get-started", label: "Get Started", icon: "rocket", adminOnly: true },
        { href: "/help", label: "Help & SOP", icon: "bookOpen", perm: "tenant_help:read" },
        { href: "/analytics", label: "Analytics", icon: "trendUp", adminOnly: true },
        { href: "/ai-insights", label: "AI Insights", icon: "sparkles", perm: "ai:read" },
        { href: "/copilot", label: "AI Copilot", icon: "sparkles", perm: "ai:copilot" },
      ],
    },
    { title: "Academic Setup", items: academic },
    {
      title: "Students & Admissions",
      items: [
        { href: "/students", label: "Students", icon: "cap", moduleKey: "students", perm: "students:read" },
        { href: "/admissions", label: "Admissions", icon: "userPlus", adminOnly: true, moduleKey: "admissions" },
        { href: "/id-cards", label: "ID Cards", icon: "card", perm: "id_cards:read" },
        { href: "/transfer-certificates", label: "Transfer Certificates", icon: "file", adminOnly: true },
        { href: "/documents", label: "Documents", icon: "file", moduleKey: "documents", perm: "documents:read" },
        { href: "/alumni", label: "Alumni", icon: "users", adminOnly: true },
      ],
    },
    {
      title: "Attendance & Daily Work",
      items: [
        { href: "/attendance", label: "Attendance", icon: "calcheck", moduleKey: "attendance" },
        { href: "/period-attendance", label: "Period Attendance", icon: "calcheck", moduleKey: "attendance" },
        { href: "/homework", label: "Homework", icon: "board", perm: "homework:read" },
        { href: "/leave", label: "Staff Leave", icon: "calcheck", perm: "leave:read" },
        { href: "/student-leave", label: "Student Leave", icon: "calcheck", perm: "student_leave:read" },
        { href: "/disciplinary", label: "Disciplinary", icon: "shield", adminOnly: true },
        { href: "/study-materials", label: "Study Materials", icon: "bookOpen" },
        { href: "/live-classes", label: "Live Classes", icon: "video" },
        { href: "/quizzes", label: "Quizzes", icon: "quiz" },
        { href: "/biometric", label: "Biometric", icon: "fingerprint", adminOnly: true },
      ],
    },
    {
      title: "Fees & Accounts",
      items: [
        { href: "/fees", label: "Fees", icon: "card", moduleKey: "fees", perm: "fees:read" },
        { href: "/fees/setup", label: "Fee Setup", icon: "gear", adminOnly: true },
        { href: "/fees/refunds", label: "Fee Refunds", icon: "receipt", adminOnly: true },
        { href: "/online-payments", label: "Online Payments", icon: "wallet", adminOnly: true },
        { href: "/accounting", label: "Accounting", icon: "wallet", adminOnly: true },
      ],
    },
    { title: "Exams & Results", items: examsResults },
    {
      title: "Staff & HR",
      items: [
        { href: "/teachers", label: "Teachers", termLabel: (t) => t.teachers, icon: "board", moduleKey: "staff" },
        { href: "/staff/directory", label: "Staff Directory", icon: "users", moduleKey: "staff", perm: "teachers:manage" },
        { href: "/staff", label: "Staff Attendance", icon: "briefcase", perm: "staff_attendance:read" },
        { href: "/payroll", label: "Payroll", icon: "wallet", adminOnly: true, moduleKey: "payroll" },
      ],
    },
    {
      title: "Operations",
      items: [
        { href: "/library", label: "Library", icon: "bookOpen", moduleKey: "library", perm: "library:read" },
        { href: "/transport", label: "Transport", icon: "bus", moduleKey: "transport", perm: "transport:read" },
        { href: "/hostel", label: "Hostel", icon: "building", moduleKey: "hostel", perm: "hostel:read" },
        { href: "/inventory", label: "Inventory", icon: "package", moduleKey: "inventory", perm: "inventory:read" },
        { href: "/front-office", label: "Front Office", icon: "help", perm: "front_office:read" },
        { href: "/infirmary", label: "Infirmary", icon: "health", adminOnly: true },
        { href: "/cafeteria", label: "Cafeteria", icon: "utensils", adminOnly: true },
        { href: "/gallery", label: "Gallery", icon: "image", adminOnly: true },
      ],
    },
    {
      title: "Communication",
      items: [
        { href: "/announcements", label: "Announcements", icon: "megaphone" },
        { href: "/communication", label: "Communication", icon: "mail", moduleKey: "communication", perm: "communication:read" },
        { href: "/messaging", label: "Messaging", icon: "message" },
        { href: "/ptm", label: "Parent Meetings", icon: "users", perm: "ptm:read" },
        { href: "/polls", label: "Polls", icon: "barChart" },
      ],
    },
    {
      title: "Reports",
      items: [{ href: "/reports-hub", label: "Reports", icon: "barChart", perm: "reports:read" }],
    },
    {
      title: "Administration",
      items: [
        { href: "/settings", label: "Settings", icon: "gear", adminOnly: true },
        { href: "/settings/rbac", label: "Roles & Permissions", icon: "shield", perm: "tenant_rbac:read" },
        { href: "/users", label: "Users", icon: "users", adminOnly: true },
        { href: "/data-io", label: "Import / Export", icon: "package", perm: "data_io:read" },
        { href: "/branding", label: "Branding", icon: "palette", adminOnly: true },
        { href: "/integrations", label: "Integrations", icon: "link", adminOnly: true },
        { href: "/jobs", label: "Jobs", icon: "gear", adminOnly: true },
        { href: "/activity", label: "Activity Log", icon: "file", adminOnly: true },
        { href: "/security", label: "Security", icon: "shield" },
      ],
    },
  ];
}

/**
 * The exact per-item gating the sidebar has applied since PR-T4, extracted so
 * the command palette shares it: adminOnly → admins (and super admins) only;
 * moduleKey → hidden when the tenant's explicit enabled-modules list excludes
 * it; perm → the caller's effective permission; termLabel → School/College
 * noun resolution. Empty groups are dropped so headers never sit alone.
 */
export function filterNavGroups(
  groups: NavGroup[],
  opts: {
    isSuper: boolean;
    isAdmin: boolean;
    enabledModules: string[] | null;
    can: (perm?: string) => boolean;
    term: TermSet;
  }
): NavGroup[] {
  const { isSuper, isAdmin, enabledModules, can, term } = opts;
  return groups
    .map((group) => ({
      title: group.title,
      items: group.items
        .filter((item) => isSuper || !item.adminOnly || isAdmin)
        .filter(
          (item) =>
            !item.moduleKey ||
            !enabledModules ||
            enabledModules.length === 0 ||
            enabledModules.includes(item.moduleKey)
        )
        .filter((item) => can(item.perm))
        .map((item) => ({ ...item, label: item.termLabel ? item.termLabel(term) : item.label })),
    }))
    .filter((group) => group.items.length > 0);
}

/** Flat list of the (already filtered) items — palette + pin/recent lookups. */
export function flattenItems(groups: NavGroup[]): NavItem[] {
  return groups.flatMap((g) => g.items);
}

/**
 * Nav diet: groups open by default per coarse role (the audit's targets —
 * a teacher lands with daily-work and exams open, an accountant with fees).
 * The group containing the active route is always forced open by the caller.
 */
export function defaultOpenGroups(role: string | undefined): Set<string> {
  switch (role) {
    case "teacher":
      return new Set(["Overview", "Attendance & Daily Work", "Exams & Results"]);
    case "accountant":
      return new Set(["Overview", "Fees & Accounts"]);
    case "admin":
      return new Set(["Overview", "Academic Setup", "Students & Admissions"]);
    default:
      return new Set(["Overview"]);
  }
}

/** Items shown per group before the "show more" fold. */
export const FOLD_LIMIT = 7;

/**
 * Fold a long group to FOLD_LIMIT entries. If the active route would be
 * hidden by the fold, the group renders unfolded — the current location is
 * never invisible.
 */
export function splitFold(
  items: NavItem[],
  activeHref: string | null,
  expanded: boolean
): { visible: NavItem[]; foldedCount: number } {
  if (expanded || items.length <= FOLD_LIMIT) return { visible: items, foldedCount: 0 };
  const activeIdx = activeHref ? items.findIndex((i) => i.href === activeHref) : -1;
  if (activeIdx >= FOLD_LIMIT) return { visible: items, foldedCount: 0 };
  return { visible: items.slice(0, FOLD_LIMIT), foldedCount: items.length - FOLD_LIMIT };
}

/**
 * Palette quick-actions: safe deep-links into existing screens — the palette
 * navigates, it never executes anything. Each action carries the SAME gates
 * as the page it opens (filtered through filterNavGroups before display), and
 * every href must exist in the nav registry (locked by nav.test.ts).
 */
export const QUICK_ACTIONS: NavItem[] = [
  { href: "/attendance", label: "Mark today's attendance", icon: "calcheck", moduleKey: "attendance" },
  { href: "/student-leave", label: "Review student leave", icon: "calcheck", perm: "student_leave:read" },
  { href: "/fees", label: "Record a fee payment", icon: "card", moduleKey: "fees", perm: "fees:read" },
  { href: "/announcements", label: "Post an announcement", icon: "megaphone" },
  { href: "/ptm", label: "Manage parent meetings", icon: "users", perm: "ptm:read" },
  { href: "/data-io", label: "Import / export data", icon: "package", perm: "data_io:read" },
];
