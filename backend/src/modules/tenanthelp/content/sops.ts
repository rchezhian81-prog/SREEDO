import type { HelpDocMeta, TenantSop } from "../tenanthelp.types";

const meta = (): HelpDocMeta => ({
  version: "1.0.0",
  lastUpdated: "2026-07-10",
  reviewStatus: "reviewed",
});

// Standard operating procedures: step-by-step, with explicit safety warnings
// and the audit trail each procedure should leave. Tenant-appropriate only —
// no platform/infra operations belong here.
export const tenantSops: TenantSop[] = [
  {
    id: "sop-year-rollover",
    title: "Academic year rollover & bulk promotion",
    category: "students",
    appliesTo: "both",
    purpose:
      "Move the institution into the new academic year and promote students in bulk without losing history.",
    steps: [
      "Export a full student list from the Data I/O center as the pre-rollover snapshot.",
      "Create the new academic year in Settings and keep the old one closed for edits.",
      "Schools: verify next-year classes/sections exist. Colleges: open the new semesters per program.",
      "Run the promotion tool per class/program — review the proposed mapping before confirming.",
      "Mark individual exceptions (retained, transferred, graduated) before confirming the batch.",
      "Spot-check a handful of students landed in the right class/semester, then reconcile counts against the snapshot.",
    ],
    safetyWarnings: [
      "Run outside teaching hours; promotion changes many records at once.",
      "Take the export snapshot FIRST — it is your recovery reference.",
      "Never re-run a promotion 'to fix' a partial one before reviewing what the first run did.",
    ],
    auditExpectation:
      "A students.promote audit entry per batch run, attributable to the operator, plus the reason-gated export entry for the snapshot.",
    links: [
      { label: "Students", href: "/students" },
      { label: "Data I/O center", href: "/data-io" },
    ],
    meta: meta(),
  },
  {
    id: "sop-admission-intake",
    title: "Admission intake: enquiry to enrolled student",
    category: "students",
    appliesTo: "both",
    purpose:
      "Take a family from first contact to an enrolled student without duplicate records.",
    steps: [
      "Record the enquiry at the front office with contact details and interest.",
      "Search existing students/enquiries before creating anything new — avoid duplicates at the source.",
      "Convert the enquiry to an application; collect documents against the checklist.",
      "On acceptance, create the student record (or convert), place into class/section (school) or enrol into program/semester (college).",
      "Link the guardian and confirm the parent portal login works.",
      "Confirm fee schedules attached and first dues are visible before closing the file.",
    ],
    safetyWarnings: [
      "Duplicate student records are far costlier to merge later than to prevent now — always search first.",
      "Do not hand over portal credentials on paper; use the parent's own email/phone reset flow.",
    ],
    auditExpectation:
      "Student create (and any update) entries naming the operator; admission status changes traceable end-to-end.",
    links: [
      { label: "Admissions", href: "/admissions" },
      { label: "Front office", href: "/front-office" },
    ],
    meta: meta(),
  },
  {
    id: "sop-fee-collection-day",
    title: "Fee collection day & reconciliation",
    category: "fees",
    appliesTo: "both",
    purpose:
      "Collect fees at the counter cleanly and reconcile the drawer against receipts at close.",
    steps: [
      "Confirm fee schedules and fine rules are current before the counter opens.",
      "For each payer: open the student's dues, record amount and mode, hand over the printed/PDF receipt.",
      "Enter mistakes are fixed by reversal (with permission) and a fresh correct entry — never by editing a receipt.",
      "At close, run the day's collection report and reconcile cash/UPI/card totals against it.",
      "Investigate any mismatch the same day; record the outcome.",
    ],
    safetyWarnings: [
      "Receipts are immutable after issue — corrections go through reversal/refund only.",
      "Reversal rights are deliberately restricted; do not share an authorised login at the counter.",
    ],
    auditExpectation:
      "One payment entry per receipt; any reversal/refund carries its own audited entry with operator and reason.",
    links: [
      { label: "Fees", href: "/fees" },
      { label: "Reports Hub", href: "/reports-hub" },
    ],
    meta: meta(),
  },
  {
    id: "sop-leave-approval",
    title: "Reviewing student leave requests",
    category: "attendance",
    appliesTo: "both",
    purpose:
      "Decide student leave consistently and keep attendance truthful automatically.",
    steps: [
      "Open Student Leave and filter to pending requests.",
      "Check the range and reason; for long ranges confirm with the guardian before approving.",
      "Approve with a short review note — the student is marked excused for every day in the range automatically.",
      "Reject with a note when policy isn't met; attendance is untouched.",
      "If an approved leave was wrong, cancel it: only the excused marks it created are removed — manual marks a teacher set survive.",
    ],
    safetyWarnings: [
      "Do not hand-edit attendance to undo a leave — cancel the leave instead; it is the reversible path.",
      "Approval rights should sit with a small set of roles (principal, class teacher, attendance officer).",
    ],
    auditExpectation:
      "student_leave.approve / .reject / .cancel entries with the reviewer's identity; excused marks attributable to the approval.",
    links: [
      { label: "Student leave", href: "/student-leave" },
      { label: "Attendance", href: "/attendance" },
    ],
    meta: meta(),
  },
  {
    id: "sop-exam-results",
    title: "Exam cycle: marks entry to published results",
    category: "exams",
    appliesTo: "both",
    purpose:
      "Get from finished exams to published Report Cards / Grade Sheets without mark disputes.",
    steps: [
      "Create the exam with subjects/courses and maximum marks before papers are graded.",
      "Subject/course teachers enter marks for their own classes; entry stays open until verification.",
      "Verify totals and outliers per section/batch (Reports Hub has the averages and failure lists).",
      "Correct any entry errors now — corrections after publication confuse families.",
      "Publish results; Report Cards (school) / Grade Sheets (college) become available to the portal.",
    ],
    safetyWarnings: [
      "Do not publish partially-entered results; missing marks read as zeros to a parent.",
      "Marks-entry permission is separate from exam management — keep it that way for four-eyes safety.",
    ],
    auditExpectation:
      "Marks entry and result publication attributable per exam; corrections visible as updates, not silent rewrites.",
    links: [
      { label: "Exams", href: "/exams" },
      { label: "Reports Hub", href: "/reports-hub" },
    ],
    meta: meta(),
  },
  {
    id: "sop-staff-onboarding",
    title: "Onboarding a staff member with the right access",
    category: "administration",
    appliesTo: "both",
    purpose:
      "Give a new staff member exactly the access their duties need — no more.",
    steps: [
      "Create the user with the correct coarse role (teacher for teaching staff, accountant for finance-only, admin only for actual administrators).",
      "Assign the finer job role that matches the duty: Fees Officer, Exam Controller, Librarian, Front Office, …",
      "Open Roles & Permissions and read the person's effective permission list — confirm it matches the duty, nothing extra.",
      "For teaching staff, add subject/class assignments so timetable and marks entry work.",
      "Have the person log in once; confirm their sidebar shows only what they should see.",
    ],
    safetyWarnings: [
      "Admin is not a convenience role — least privilege first; escalate later if truly needed.",
      "Never share logins between staff; the audit trail is only as good as account hygiene.",
    ],
    auditExpectation:
      "User creation and role/job-role assignment entries naming the administrator who granted access.",
    links: [
      { label: "Users", href: "/users" },
      { label: "Roles & permissions", href: "/settings/rbac" },
    ],
    meta: meta(),
  },
  {
    id: "sop-governed-export",
    title: "Exporting data under governance",
    category: "administration",
    appliesTo: "both",
    purpose:
      "Export institutional data for legitimate needs while keeping a defensible trail.",
    steps: [
      "Use the Data I/O center — it is the one governed door for exports.",
      "Pick the entity; if it is marked sensitive, provide a genuine, specific reason (it is recorded verbatim).",
      "Download and store the file according to your data-handling policy; delete scratch copies when done.",
      "For recurring needs, prefer scheduled reports over ad-hoc exports of the same data.",
    ],
    safetyWarnings: [
      "Exported files leave the system's protection — treat spreadsheets with student data as confidential documents.",
      "Vague reasons ('backup', 'check') defeat the governance point; write what the export is actually for.",
    ],
    auditExpectation:
      "Every sensitive export logged with operator, entity, timestamp and the stated reason.",
    links: [{ label: "Data I/O center", href: "/data-io" }],
    meta: meta(),
  },
  {
    id: "sop-ptm-cycle",
    title: "Running a parent-teacher meeting cycle",
    category: "communication",
    appliesTo: "both",
    purpose:
      "Plan, invite, run and follow up a PTM so every conversation is captured.",
    steps: [
      "Create the meeting with date and the classes/programs in scope.",
      "Add slot blocks per teacher — short slots, enough of them, with buffers.",
      "Send invites; re-send reminders to non-responders a few days out.",
      "On the day, mark attendance per booking and record a one-line outcome note.",
      "Afterwards, review attendance and notes; export the summary for follow-ups where needed.",
    ],
    safetyWarnings: [
      "Outcome notes are read by colleagues later — keep them factual and free of sensitive speculation.",
    ],
    auditExpectation:
      "Meeting creation, invite sends and any export appear in the audit trail under the organiser's identity.",
    links: [{ label: "Parent meetings", href: "/ptm" }],
    meta: meta(),
  },
  {
    id: "sop-semester-opening",
    title: "Opening a new semester",
    category: "academics",
    appliesTo: "college",
    purpose:
      "Open the next semester per program and move cohorts forward cleanly.",
    steps: [
      "Create the new semester under each program that continues.",
      "Attach the semester's courses and assign faculty.",
      "Enrol continuing students into the new semester (per batch where used).",
      "Verify exam eligibility and fee schedules point at the new semester.",
      "Close marks entry for the previous semester once grade sheets are published.",
    ],
    safetyWarnings: [
      "Enrolments drive everything downstream — reconcile cohort counts before teaching starts.",
    ],
    auditExpectation:
      "Semester creation and bulk enrolment operations attributable to the coordinator who ran them.",
    links: [
      { label: "Semesters", href: "/college/semesters" },
      { label: "Enrolments", href: "/college/enrollments" },
    ],
    meta: meta(),
  },
];
