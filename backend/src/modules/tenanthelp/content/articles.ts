import type { HelpDocMeta, TenantHelpArticle } from "../tenanthelp.types";

const meta = (): HelpDocMeta => ({
  version: "1.0.0",
  lastUpdated: "2026-07-10",
  reviewStatus: "reviewed",
});

// How-to articles for the live tenant modules. Bodies are trusted markdown-ish
// prose (headings/bullets/paragraphs — see the RichText renderer). Written
// terminology-neutral: where School and College nouns differ, both are named
// (Class/Program, Section/Batch, Report Card/Grade Sheet).
export const tenantHelpArticles: TenantHelpArticle[] = [
  {
    id: "art-students-basics",
    title: "Students: profiles, admission numbers and guardians",
    category: "students",
    appliesTo: "both",
    summary:
      "How student records work — creating them, admission/registration numbers, and linking guardians so parents get portal access.",
    body: `# Creating students
Add students from the Students page. Only first and last name are required to start; everything else (demographics, contacts, documents) can be completed later from the same Edit form.

# Admission vs registration numbers
Schools use an Admission No, colleges a Registration No. A number is generated automatically when left blank; supply your own to keep an existing series.

# Guardians and parent logins
- Add a guardian inline on the student form with a relationship (mother, father, guardian).
- Linking a guardian to a parent user account gives that parent portal access to exactly their own children — attendance, homework, fees, reports.
- One parent account can be linked to several children; the portal scopes everything to those children only.

# Where placement happens
Schools place a student into a class and section on the profile. Colleges place students via program/semester enrolments instead — see the college structure article.`,
    links: [
      { label: "Students", href: "/students" },
      { label: "Data I/O center", href: "/data-io" },
    ],
    meta: meta(),
  },
  {
    id: "art-students-import",
    title: "Bulk import and export via the Data I/O center",
    category: "students",
    appliesTo: "both",
    summary:
      "Import students and other records from spreadsheets, and export data with the governed, audited export center.",
    body: `# Importing
The Data I/O center imports records from CSV/XLSX. Download the template for the entity, fill it, and upload — every row is validated and the result screen lists accepted rows and per-row errors so you can fix and re-upload just the failures.

# Import history
Each import is recorded with who ran it, when, and the outcome counts — so a surprise batch of records is always traceable.

# Exporting
- Any export you are permitted to run is delivered as CSV/XLSX.
- Exports marked sensitive (student lists with contact details, leave requests with reasons, …) require a short reason, which is written to the audit log with your name.
- Export permissions layer on top of module read permissions — having students:read does not by itself grant exporting them.

# Good practice
Prefer one clean import over many partial ones, and run a small 5-row test file first when migrating from another system.`,
    links: [{ label: "Data I/O center", href: "/data-io" }],
    meta: meta(),
  },
  {
    id: "art-attendance-daily",
    title: "Daily and period attendance",
    category: "attendance",
    appliesTo: "both",
    summary:
      "Marking daily attendance, the four statuses, per-period attendance, and how approved leave shows up as excused.",
    body: `# Daily marking
Pick the date and section/batch, mark each student present, absent, late or excused, and save. Re-saving the same day updates the existing marks — nothing is duplicated.

# The 'excused' status
Excused means an absence that shouldn't count against the student. Approving a student-leave request marks every day in the leave range excused automatically; cancelling that approval removes only those excused marks and never touches marks a teacher set by hand.

# Period attendance
Where subject-wise tracking matters, Period Attendance records presence per timetable period. It complements — not replaces — the daily register.

# Reports
Attendance percentage per student, class/program summaries and low-attendance flags live in Reports Hub, and the AI Insights page highlights attendance-risk students early.`,
    links: [
      { label: "Attendance", href: "/attendance" },
      { label: "Period attendance", href: "/period-attendance" },
      { label: "Student leave", href: "/student-leave" },
    ],
    meta: meta(),
  },
  {
    id: "art-student-leave",
    title: "Student leave: filing, approval and attendance",
    category: "attendance",
    appliesTo: "both",
    summary:
      "File leave on a student's behalf, approve or reject it, and understand the safe, reversible link to attendance.",
    body: `# Filing
Staff with the create permission file leave from the Student Leave page: pick the student, type (sick, casual, emergency, other), the date range and a reason. Parents with linked children can file through the guardian API; their requests appear in the same queue.

# Review
Approvers see pending requests with the full context. Approving marks the student excused in daily attendance for every date in the range; rejecting changes nothing in attendance. Both record a review note and are written to the audit log.

# Cancelling safely
Cancelling an approved leave removes only the excused marks that the approval created. If a teacher later marked one of those days present or absent by hand, that manual mark survives the cancellation.

# Permissions
Reading, filing and approving are three separate permissions, so a front-office clerk can file requests that only the principal or class teacher can approve.`,
    links: [
      { label: "Student leave", href: "/student-leave" },
      { label: "Attendance", href: "/attendance" },
    ],
    meta: meta(),
  },
  {
    id: "art-fees-setup",
    title: "Fee setup: categories, schedules, fines and discounts",
    category: "fees",
    appliesTo: "both",
    summary:
      "Model your fee structure once — categories, schedules per class/program, fine rules and discounts — and collections follow.",
    body: `# Categories
Categories are the ledger lines (Tuition, Transport, Lab, …). Keep them few and stable; reports aggregate by category.

# Schedules
A schedule attaches an amount and due date to a category for a class/program (e.g. Tuition, Grade 5, ₹12,000, due 10 June). Students inherit the schedules of their placement automatically.

# Fine rules
Fine rules add late fees after the due date — flat or per-day, with an optional cap. Fines appear as their own line on the dues screen so parents can see the split.

# Discounts
Discounts (sibling, scholarship, staff ward, …) can be percentage or fixed and are applied per student. Every application is visible on the student's fee view.

# Order of work
Set categories first, then schedules, then fines/discounts. Changing a schedule later affects future dues only — recorded payments and receipts are never rewritten.`,
    links: [{ label: "Fee setup", href: "/fees/setup" }],
    meta: meta(),
  },
  {
    id: "art-fees-collect",
    title: "Collecting fees, receipts and refunds",
    category: "fees",
    appliesTo: "both",
    summary:
      "Recording payments against dues, issuing receipts, and the controlled paths for reversals and refunds.",
    body: `# Recording a payment
Open the student's dues from the Fees page, enter the amount and payment mode, and save — a numbered receipt is generated immediately and the dues balance updates. Partial payments are fine; the remainder stays due.

# Receipts
Receipts are download-and-reprint-able PDFs. A receipt is never edited after issue — corrections go through reversal or refund so the money trail stays honest.

# Reversals and refunds
- A reversal cancels a wrongly-entered payment; it needs the dedicated reversal permission and is audited.
- A refund returns money against a real payment (withdrawal, overpayment) from the Refunds page, with its own record and audit entry.

# Online payments
When a payment gateway is configured, parents can pay dues from the portal; successful payments post automatically with the same receipts and reports as counter payments.`,
    links: [
      { label: "Fees", href: "/fees" },
      { label: "Refunds", href: "/fees/refunds" },
    ],
    meta: meta(),
  },
  {
    id: "art-exams-marks",
    title: "Exams, marks entry and report cards / grade sheets",
    category: "exams",
    appliesTo: "both",
    summary:
      "Create exams, enter marks per subject/course, and publish the term Report Card (school) or semester Grade Sheet (college).",
    body: `# Creating an exam
Define the exam (name, term/semester, classes or programs it covers) and the subjects/courses with maximum marks. Exam definitions are reusable per academic period.

# Entering marks
Marks entry is per subject/course and per section/batch, gated by its own permission so subject teachers can enter marks without wider exam-management rights. Entries can be corrected until results are published.

# Publishing results
Once marks are complete, results roll up into the student's term Report Card (school) or semester Grade Sheet (college), visible to staff and — when you choose to publish — to students and parents in the portal.

# Analysis
Reports Hub carries subject-wise averages, toppers and failure lists; AI Insights can summarise a student's performance trend across exams.`,
    links: [
      { label: "Exams", href: "/exams" },
      { label: "Reports Hub", href: "/reports-hub" },
    ],
    meta: meta(),
  },
  {
    id: "art-timetable",
    title: "Timetable building and auto-generation",
    category: "academics",
    appliesTo: "both",
    summary:
      "Define periods, assign subjects and teachers, and let the generator propose a clash-free draft.",
    body: `# Setup
Define the working days and period grid first (Timetable → Setup), then the subject requirements per class/program — which subjects, how many periods a week, which teachers can take them.

# Manual building
Place subjects into the grid per section/batch. The editor blocks a teacher from being in two places in the same period.

# Auto-generation
The generator takes the requirements and produces a clash-free draft in one click. Review it, swap what you don't like, and publish. Regenerating never overwrites a published timetable without confirmation.

# Teacher view
Each teacher sees their own week at a glance, and the workload report shows load distribution across staff.`,
    links: [
      { label: "Timetable", href: "/timetable" },
      { label: "Auto-generate", href: "/timetable/generate" },
    ],
    meta: meta(),
  },
  {
    id: "art-communication",
    title: "Announcements, messages and audiences",
    category: "communication",
    appliesTo: "both",
    summary:
      "Broadcast announcements or target a class, section, batch or single student's guardians — in-app always, email when configured.",
    body: `# Announcements vs messages
Announcements are broadcast notices (holiday, event, circular) shown to everyone in scope. Messages target a specific audience and land in each recipient's inbox.

# Audiences
A message can target all parents, a class/program, a section/batch, or a single student (which reaches the student and their guardians). The audience is resolved at send time, so new admissions automatically receive later messages to their group.

# Delivery
Everything is delivered in-app. When SMTP is configured, recipients with email addresses also get the message by mail; when it is not, sending still works and simply skips email — nothing fails.

# Automatic notifications
Some modules notify for you: PTM invites, student-leave decisions, fee receipts. These reuse the same inbox, so parents have one place to look.`,
    links: [{ label: "Communication", href: "/communication" }],
    meta: meta(),
  },
  {
    id: "art-rbac-roles",
    title: "Roles and permissions: giving staff exactly enough",
    category: "administration",
    appliesTo: "both",
    summary:
      "Coarse roles, finer job roles (Principal, Fees Officer, Librarian, …) and how effective permissions are resolved.",
    body: `# Two layers
Every user has a coarse role (admin, teacher, accountant, student, parent). Staff can additionally carry a finer job role — Principal, Admin Officer, Fees Officer, Exam Controller, Librarian and more — which replaces the coarse defaults with a curated permission set.

# Assigning a job role
From Users, pick the staff member and assign the job role. The RBAC screen shows the effective permissions the person ends up with, so there is never guesswork about what they can do.

# Tenant overrides
Institution owners can tailor a role's permission set for their institution from Settings → Roles & Permissions. Guard rails prevent locking every admin out of user/role management.

# Safe defaults
Job roles follow least privilege: a Fees Officer cannot reverse payments by default, a Librarian sees only the library, and a read-only Auditor can view everything but change nothing.`,
    links: [
      { label: "Users", href: "/users" },
      { label: "Roles & permissions", href: "/settings/rbac" },
    ],
    meta: meta(),
  },
  {
    id: "art-ptm",
    title: "Parent-teacher meetings (PTM)",
    category: "communication",
    appliesTo: "both",
    summary:
      "Schedule a PTM, open bookable slots per teacher, invite parents, and record attendance and outcomes.",
    body: `# Scheduling
Create the meeting (date, purpose, classes/programs in scope) and add per-teacher slot blocks. Slots are what parents book — keep them short and plentiful.

# Invites
Sending invites uses the communication module, so parents get an in-app message (plus email when configured) with the booking details. Reminders can be re-sent to non-responders.

# On the day
The organiser view shows each teacher's schedule. Mark attendance per booking and capture a short outcome note — those notes are the institution's memory of the conversation.

# After
Attendance and notes feed the PTM export for follow-up, gated and audited like every sensitive export.`,
    links: [{ label: "Parent meetings", href: "/ptm" }],
    meta: meta(),
  },
  {
    id: "art-front-office",
    title: "Front office: visitors, enquiries, postal, calls, lost & found",
    category: "operations",
    appliesTo: "both",
    summary:
      "The reception desk in one place — walk-ins, admission enquiries, dispatch/receipt of post, call log and lost & found.",
    body: `# Visitors
Log walk-ins with purpose and whom they are meeting; sign-out completes the trail. The register doubles as the security gate record.

# Enquiries
Admission enquiries capture the family's details and interest, and can be converted into an application later without retyping.

# Postal and calls
Record inbound/outbound post and phone calls with references, so "did we receive it?" always has an answer.

# Lost & found
Log found items, record claims, and hand items back against a name — nothing lives in a drawer unaccounted.`,
    links: [{ label: "Front office", href: "/front-office" }],
    meta: meta(),
  },
  {
    id: "art-school-structure",
    title: "School structure: classes, sections and class teachers",
    category: "academics",
    appliesTo: "school",
    summary:
      "How the class/section model works in school mode and what the class-teacher role covers.",
    body: `# Classes and sections
A class is the grade (Grade 6); sections (A, B) are its parallel groups. Students belong to exactly one class/section at a time; timetable, attendance and most reports run per section.

# Class teachers
Assigning a class teacher gives that teacher day-to-day duties for the section: marking attendance, homework, parent communication and basic reports — via the Class Teacher job role.

# Promotion
At year end the promotion tool moves students up a class (or holds them back individually). See the year-rollover SOP before running it.`,
    links: [
      { label: "Classes", href: "/classes" },
      { label: "Students", href: "/students" },
    ],
    meta: meta(),
  },
  {
    id: "art-college-structure",
    title: "College structure: departments, programs, semesters and batches",
    category: "academics",
    appliesTo: "college",
    summary:
      "How the college hierarchy fits together and how students move through semesters via enrolments.",
    body: `# The hierarchy
Departments group programs; programs run in semesters; a batch is the cohort admitted together. Courses (subjects) attach to program+semester.

# Enrolments
A student's place in the college is an enrolment record: program + semester (+ batch). Moving to the next semester is a new enrolment, which keeps a clean history of the student's progression.

# Faculty
Faculty belong to departments and teach courses. The Faculty Advisor plays the pastoral role a class teacher plays in schools.

# Grade sheets
Results publish per semester as Grade Sheets, and transcripts build on the enrolment history.`,
    links: [
      { label: "Departments", href: "/college/departments" },
      { label: "Programs", href: "/college/programs" },
      { label: "Enrolments", href: "/college/enrollments" },
    ],
    meta: meta(),
  },
];
