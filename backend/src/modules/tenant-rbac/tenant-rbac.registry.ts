// PR-T2 — Tenant RBAC v2: the tenant-side permission registry.
//
// This is the tenant counterpart to the platform RBAC registry. It groups the
// *tenant-relevant* permission keys (the ones that actually gate tenant routes
// via `requirePermission(...)`) into human-readable module groups for the RBAC
// matrix UI. It deliberately contains ONLY keys that enforce something — no dead
// toggles. Platform-scoped keys (platform:*, backup:*, jobs:*, export:*, comm:*,
// observability:*, overview:*, help:*, restore:*, incident:*, alert:*, error:*)
// are Super-Admin surface and are intentionally excluded.
//
// The registry does not grant anything by itself — role→permission defaults live
// in the global `role_permissions` table (seeded by migrations), and per-tenant
// overrides live in `tenant_role_permissions` (migration 0106). This file is the
// display/grouping + high-risk + school/college-applicability source of truth.

export type Applicability = "school" | "college" | "both";

export interface TenantPermission {
  key: string;
  label: string;
  /** High-risk grants require a reason and a confirm step in the UI. */
  highRisk?: boolean;
  /** Narrows a permission to one institution type; defaults to the group's. */
  appliesTo?: Applicability;
}

export interface TenantPermissionGroup {
  key: string;
  title: string;
  appliesTo: Applicability;
  permissions: TenantPermission[];
}

// The five assignable tenant roles (the `user_role` values that carry an
// institution context). super_admin is a platform role and is never a tenant
// role. These are built-in and cannot be deleted; their permissions are
// customisable per tenant via tenant_role_permissions.
export interface TenantRoleMeta {
  key: string;
  name: string;
  description: string;
  appliesTo: Applicability;
  builtIn: true;
  /** Management role — protected from self-lockout / last-owner removal. */
  management?: boolean;
  /** Restricted portal role — can never receive admin/high-risk grants. */
  restricted?: boolean;
}

export const TENANT_ROLES: TenantRoleMeta[] = [
  {
    key: "admin",
    name: "Institution Admin / Management",
    description:
      "Full tenant administration: settings, users, RBAC, and every module. The tenant owner role — always retains RBAC and user management.",
    appliesTo: "both",
    builtIn: true,
    management: true,
  },
  {
    key: "teacher",
    name: "Teacher / Faculty",
    description:
      "Teaching staff: attendance marking, exam marks entry, homework, and class/academic reads. No settings, fees, users or RBAC by default.",
    appliesTo: "both",
    builtIn: true,
  },
  {
    key: "accountant",
    name: "Accounts / Fees Officer",
    description:
      "Finance staff: fees, receipts, payments, discounts, fines and financial reports. No academic marks or RBAC by default.",
    appliesTo: "both",
    builtIn: true,
  },
  {
    key: "student",
    name: "Student",
    description:
      "Portal-only: own attendance, marks, fees, timetable and materials. Restricted from every admin surface.",
    appliesTo: "both",
    builtIn: true,
    restricted: true,
  },
  {
    key: "parent",
    name: "Parent / Guardian",
    description:
      "Portal-only: their children's attendance, marks and fees. Restricted from every admin surface.",
    appliesTo: "both",
    builtIn: true,
    restricted: true,
  },
];

export const TENANT_ROLE_KEYS = TENANT_ROLES.map((r) => r.key);

// Roles that must never be granted admin / high-risk / management permissions,
// no matter what a tenant admin toggles. Enforced server-side in the service.
export const RESTRICTED_ROLE_KEYS = new Set(
  TENANT_ROLES.filter((r) => r.restricted).map((r) => r.key)
);

// The registry. Groups roughly mirror the Tenant-Admin roadmap's permission
// groups; only groups that have real, enforced tenant keys are included.
export const TENANT_PERMISSION_GROUPS: TenantPermissionGroup[] = [
  {
    key: "rbac",
    title: "Roles & Permissions",
    appliesTo: "both",
    permissions: [
      { key: "tenant_rbac:read", label: "View roles & permission matrix" },
      { key: "tenant_rbac:manage", label: "Edit role permissions & reset roles", highRisk: true },
    ],
  },
  {
    key: "users",
    title: "Tenant Users",
    appliesTo: "both",
    permissions: [
      { key: "users:manage", label: "Create / edit / disable users & assign roles", highRisk: true },
    ],
  },
  {
    key: "students",
    title: "Student Management",
    appliesTo: "both",
    permissions: [
      { key: "students:create", label: "Enroll a student" },
      { key: "students:update", label: "Edit a student" },
      { key: "students:delete", label: "Archive / delete a student", highRisk: true },
      { key: "students:import", label: "Bulk-import students" },
      { key: "students:promote", label: "Promote / graduate students" },
    ],
  },
  {
    key: "staff",
    title: "Teachers & Staff (HR)",
    appliesTo: "both",
    permissions: [
      { key: "teachers:manage", label: "Add / edit / remove teachers" },
      { key: "staff_attendance:read", label: "View staff attendance" },
      { key: "staff_attendance:create", label: "Mark staff attendance" },
      { key: "staff_attendance:update", label: "Edit staff attendance" },
      { key: "staff_attendance:delete", label: "Delete staff attendance" },
      { key: "leave:read", label: "View leave" },
      { key: "leave:create", label: "Apply leave" },
      { key: "leave:approve", label: "Approve leave" },
      { key: "leave:reject", label: "Reject leave" },
      { key: "payroll:read", label: "View payroll" },
      { key: "payroll:create", label: "Create payroll runs" },
      { key: "payroll:update", label: "Edit payroll" },
      { key: "payroll:run", label: "Process payroll", highRisk: true },
      { key: "payroll:finalize", label: "Finalize payroll", highRisk: true },
      { key: "payroll:payslip", label: "Generate payslips" },
      { key: "payroll:delete", label: "Delete payroll" },
    ],
  },
  {
    key: "attendance",
    title: "Attendance",
    appliesTo: "both",
    permissions: [
      { key: "attendance:mark", label: "Mark / edit student attendance" },
    ],
  },
  {
    key: "exams",
    title: "Exams & Results",
    appliesTo: "both",
    permissions: [
      { key: "exams:manage", label: "Create / edit exams" },
      { key: "exams:enter_marks", label: "Enter / edit marks", highRisk: true },
      { key: "report_cards:read", label: "View report cards" },
      { key: "report_cards:generate", label: "Generate report cards" },
      { key: "mark_sheets:export", label: "Export mark sheets", highRisk: true },
    ],
  },
  {
    key: "timetable",
    title: "Timetable",
    appliesTo: "both",
    permissions: [
      { key: "timetable:read", label: "View timetable" },
      { key: "timetable:create", label: "Create timetable" },
      { key: "timetable:update", label: "Edit timetable" },
      { key: "timetable:delete", label: "Delete timetable" },
      { key: "timetable:export", label: "Export timetable", highRisk: true },
    ],
  },
  {
    key: "fees",
    title: "Fees & Accounts",
    appliesTo: "both",
    permissions: [
      { key: "fees:manage", label: "Create / edit invoices & fee structures" },
      { key: "fees:payment", label: "Record fee payments" },
      { key: "fees:reverse", label: "Reverse / cancel / void a payment", highRisk: true },
      { key: "fee_categories:read", label: "View fee categories" },
      { key: "fee_categories:create", label: "Create fee categories" },
      { key: "fee_categories:update", label: "Edit fee categories" },
      { key: "fee_categories:delete", label: "Delete fee categories" },
      { key: "fee_schedules:read", label: "View fee schedules" },
      { key: "fee_schedules:create", label: "Create fee schedules" },
      { key: "fee_schedules:update", label: "Edit fee schedules" },
      { key: "fee_schedules:generate", label: "Generate fee demands" },
      { key: "fee_fines:read", label: "View fines" },
      { key: "fee_fines:apply", label: "Apply fines" },
      { key: "fee_fines:waive", label: "Waive fines", highRisk: true },
      { key: "fee_discounts:read", label: "View discounts" },
      { key: "fee_discounts:apply", label: "Apply discounts" },
      { key: "fee_discounts:approve", label: "Approve discounts", highRisk: true },
      { key: "fee_receipts:download", label: "Download fee receipts" },
      { key: "online_payments:read", label: "View online payments" },
      { key: "online_payments:create", label: "Create online payments" },
      { key: "online_payments:refund", label: "Refund online payments", highRisk: true },
      { key: "online_payments:settings", label: "Edit payment gateway settings", highRisk: true },
    ],
  },
  {
    key: "communication",
    title: "Communication",
    appliesTo: "both",
    permissions: [
      { key: "communication:read", label: "View communication" },
      { key: "communication:create", label: "Create communication" },
      { key: "communication:send", label: "Send communication" },
      { key: "communication:delete", label: "Delete communication" },
      { key: "notifications:send", label: "Send notifications" },
      { key: "threads:read", label: "View message threads" },
      { key: "threads:create", label: "Start message threads" },
      { key: "threads:reply", label: "Reply to threads" },
      { key: "threads:manage", label: "Manage threads" },
      { key: "threads:delete", label: "Delete threads" },
    ],
  },
  {
    key: "documents",
    title: "Documents & Certificates",
    appliesTo: "both",
    permissions: [
      { key: "documents:read", label: "View documents" },
      { key: "documents:upload", label: "Upload documents" },
      { key: "documents:download", label: "Download documents" },
      { key: "documents:delete", label: "Delete documents" },
      { key: "institution:logo:update", label: "Update institution logo" },
      { key: "transfer_certificates:read", label: "View transfer certificates" },
      { key: "transfer_certificates:create", label: "Create transfer certificates" },
      { key: "transfer_certificates:update", label: "Edit transfer certificates" },
      { key: "transfer_certificates:issue", label: "Issue transfer certificates" },
      { key: "transfer_certificates:cancel", label: "Cancel transfer certificates" },
      { key: "transfer_certificates:download", label: "Download transfer certificates" },
      { key: "id_cards:download", label: "Download ID cards" },
      { key: "id_cards:generate", label: "Generate ID cards" },
    ],
  },
  {
    key: "transport",
    title: "Transport",
    appliesTo: "both",
    permissions: [
      { key: "transport:read", label: "View transport" },
      { key: "transport:create", label: "Create routes / vehicles / stops" },
      { key: "transport:update", label: "Edit transport" },
      { key: "transport:delete", label: "Delete transport" },
      { key: "transport:allocate", label: "Assign students to transport" },
      { key: "transport:fees", label: "Manage transport fees", highRisk: true },
    ],
  },
  {
    key: "hostel",
    title: "Hostel",
    appliesTo: "both",
    permissions: [
      { key: "hostel:read", label: "View hostel" },
      { key: "hostel:create", label: "Create rooms / blocks" },
      { key: "hostel:update", label: "Edit hostel" },
      { key: "hostel:delete", label: "Delete hostel" },
      { key: "hostel:allocate", label: "Assign students to hostel" },
      { key: "hostel:fees", label: "Manage hostel fees", highRisk: true },
    ],
  },
  {
    key: "library",
    title: "Library",
    appliesTo: "both",
    permissions: [
      { key: "library:read", label: "View library" },
      { key: "library:create", label: "Add books" },
      { key: "library:update", label: "Edit books" },
      { key: "library:delete", label: "Delete books" },
      { key: "library:issue", label: "Issue books" },
      { key: "library:return", label: "Return books" },
      { key: "library:fines", label: "Manage library fines", highRisk: true },
    ],
  },
  {
    key: "inventory",
    title: "Inventory",
    appliesTo: "both",
    permissions: [
      { key: "inventory:read", label: "View inventory" },
      { key: "inventory:create", label: "Create inventory items" },
      { key: "inventory:update", label: "Edit inventory" },
      { key: "inventory:delete", label: "Delete inventory" },
      { key: "inventory:issue", label: "Issue inventory" },
      { key: "inventory:purchase", label: "Record purchases" },
      { key: "inventory:adjust", label: "Adjust stock" },
    ],
  },
  {
    key: "discipline",
    title: "Discipline & Behaviour",
    appliesTo: "both",
    permissions: [
      { key: "disciplinary:read", label: "View discipline records" },
      { key: "disciplinary:create", label: "Create discipline records" },
      { key: "disciplinary:update", label: "Edit discipline records" },
      { key: "disciplinary:action", label: "Take disciplinary action" },
      { key: "disciplinary:close", label: "Close / resolve records" },
      { key: "disciplinary:delete", label: "Delete discipline records", highRisk: true },
    ],
  },
  {
    key: "homework",
    title: "Homework & Assignments",
    appliesTo: "both",
    permissions: [
      { key: "homework:read", label: "View assignments" },
      { key: "homework:create", label: "Create assignments" },
      { key: "homework:update", label: "Edit assignments" },
      { key: "homework:delete", label: "Delete assignments" },
      { key: "homework:review", label: "Grade / review submissions" },
    ],
  },
  {
    key: "reports",
    title: "Reports & Analytics",
    appliesTo: "both",
    permissions: [
      { key: "reports:read", label: "View reports" },
      { key: "reports:center:read", label: "View report center" },
      { key: "custom_reports:read", label: "View custom reports" },
      { key: "custom_reports:create", label: "Create custom reports" },
      { key: "custom_reports:update", label: "Edit custom reports" },
      { key: "custom_reports:delete", label: "Delete custom reports" },
      { key: "custom_reports:run", label: "Run custom reports" },
      { key: "custom_reports:export", label: "Export custom reports", highRisk: true },
      { key: "scheduled_reports:read", label: "View scheduled reports" },
      { key: "scheduled_reports:create", label: "Create scheduled reports" },
      { key: "scheduled_reports:update", label: "Edit scheduled reports" },
      { key: "scheduled_reports:delete", label: "Delete scheduled reports" },
      { key: "scheduled_reports:run", label: "Run scheduled reports" },
      { key: "scheduled_reports:manage", label: "Manage scheduled reports" },
      { key: "scheduled_reports:history", label: "View scheduled-report history" },
    ],
  },
  {
    key: "data_io",
    title: "Import / Export",
    appliesTo: "both",
    permissions: [
      { key: "data_io:read", label: "View the Import/Export center & history" },
      { key: "data_io:import", label: "Import data (dry-run + commit)", highRisk: true },
      { key: "data_io:export", label: "Export tenant data (CSV / XLSX)", highRisk: true },
    ],
  },
  {
    key: "ai",
    title: "AI Insights",
    appliesTo: "both",
    permissions: [
      { key: "ai:read", label: "View AI insights" },
      { key: "ai:summarize", label: "AI summaries" },
      { key: "ai:document_search", label: "AI document search" },
      { key: "ai:risk_alerts", label: "AI risk alerts" },
      { key: "ai:workflow_suggestions", label: "AI workflow suggestions" },
    ],
  },
  {
    key: "academic_setup",
    title: "Academic Setup (School)",
    appliesTo: "both",
    permissions: [
      { key: "academic_years:manage", label: "Manage academic years" },
      { key: "classes:manage", label: "Manage classes", appliesTo: "school" },
      { key: "sections:manage", label: "Manage sections", appliesTo: "school" },
      { key: "subjects:manage", label: "Manage subjects" },
    ],
  },
  {
    key: "admissions",
    title: "Admissions & Enquiries",
    appliesTo: "both",
    permissions: [
      { key: "admissions:read", label: "View admissions & enquiries" },
      { key: "admissions:create", label: "Create admission / enquiry" },
      { key: "admissions:update", label: "Edit admission" },
      { key: "admissions:convert", label: "Convert enquiry to student" },
      { key: "admissions:delete", label: "Delete admission" },
    ],
  },
  {
    key: "front_office",
    title: "Front Office",
    appliesTo: "both",
    permissions: [
      { key: "front_office:read", label: "View visitors / front office" },
      { key: "front_office:manage", label: "Manage visitors / front office" },
    ],
  },
  {
    key: "ptm",
    title: "Parent Meetings (PTM)",
    appliesTo: "both",
    permissions: [
      { key: "ptm:read", label: "View parent-teacher meetings" },
      { key: "ptm:manage", label: "Schedule PTMs, slots, attendance & invites" },
    ],
  },
  {
    key: "student_leave",
    title: "Student Leave",
    appliesTo: "both",
    permissions: [
      { key: "student_leave:read", label: "View student leave requests" },
      { key: "student_leave:create", label: "File a student leave request" },
      { key: "student_leave:approve", label: "Approve / reject student leave" },
    ],
  },
  {
    key: "calendar",
    title: "Calendar & Events",
    appliesTo: "both",
    permissions: [
      { key: "calendar:manage", label: "Create / edit / delete events" },
      { key: "announcements:manage", label: "Publish announcements" },
    ],
  },
  {
    key: "college_academics",
    title: "Academic Setup (College)",
    appliesTo: "college",
    permissions: [
      { key: "college:read", label: "View college setup" },
      { key: "college:create", label: "Create college setup" },
      { key: "college:update", label: "Edit college setup" },
      { key: "college:delete", label: "Delete college setup" },
      { key: "departments:read", label: "View departments" },
      { key: "departments:create", label: "Manage departments" },
      { key: "programs:read", label: "View programs" },
      { key: "programs:create", label: "Manage programs" },
      { key: "semesters:read", label: "View semesters" },
      { key: "semesters:create", label: "Manage semesters" },
    ],
  },
];

// Flat set of every high-risk key (for fast server-side reason enforcement).
export const HIGH_RISK_KEYS = new Set<string>(
  TENANT_PERMISSION_GROUPS.flatMap((g) =>
    g.permissions.filter((p) => p.highRisk).map((p) => p.key)
  )
);

// Every registry key (for validating update payloads).
export const ALL_TENANT_PERMISSION_KEYS = new Set<string>(
  TENANT_PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key))
);

// The core management keys the `admin` role must always retain — prevents a
// tenant from locking every admin out of RBAC/user management (last-owner
// protection). admin can customise everything else.
export const ADMIN_PROTECTED_KEYS = new Set<string>([
  "tenant_rbac:read",
  "tenant_rbac:manage",
  "users:manage",
]);
