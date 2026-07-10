import type { GettingStartedSection, HelpDocMeta } from "../tenanthelp.types";

const meta = (): HelpDocMeta => ({
  version: "1.0.0",
  lastUpdated: "2026-07-10",
  reviewStatus: "reviewed",
});

// The guided version of the /get-started checklist: same order, with the "why"
// spelled out. School and college get their own section; "daily rhythm" is
// shared. (The /get-started page itself is untouched — this is the narrative.)
export const gettingStartedSections: GettingStartedSection[] = [
  {
    id: "gs-school-setup",
    title: "Set up your school",
    appliesTo: "school",
    steps: [
      {
        title: "Create classes & sections",
        description:
          "Classes (Grade 1, Grade 2, …) and their sections (A, B, …) are the backbone every other module hangs on — students are placed into a class/section, the timetable is built per section, and attendance is marked per section.",
        href: "/classes",
      },
      {
        title: "Add teachers",
        description:
          "Create teacher profiles before importing students so class-teacher and subject assignments can be made as soon as classes exist. Each teacher gets a login automatically.",
        href: "/teachers",
      },
      {
        title: "Add or import students",
        description:
          "Add students one at a time from the Students page, or bulk-import from a spreadsheet via the Data I/O center. Admission numbers are generated automatically unless you supply your own.",
        href: "/students",
      },
      {
        title: "Build the timetable",
        description:
          "Define periods and assign subjects + teachers per section. The auto-generator can propose a clash-free draft you can adjust by hand.",
        href: "/timetable",
      },
      {
        title: "Configure fees",
        description:
          "Set up fee categories and schedules (with optional fines and discounts) so collections, receipts and dues reports work from day one.",
        href: "/fees/setup",
      },
    ],
    meta: meta(),
  },
  {
    id: "gs-college-setup",
    title: "Set up your college",
    appliesTo: "college",
    steps: [
      {
        title: "Create departments",
        description:
          "Departments (Science, Commerce, Engineering, …) group your programs and faculty and drive department-level reporting.",
        href: "/college/departments",
      },
      {
        title: "Create programs",
        description:
          "Programs (B.Sc., B.Com., …) are what students enrol into. Each belongs to a department and carries its own duration.",
        href: "/college/programs",
      },
      {
        title: "Open semesters",
        description:
          "Create the semesters for each program. Enrolment, courses, exams and grade sheets are all organised per semester.",
        href: "/college/semesters",
      },
      {
        title: "Add faculty",
        description:
          "Create faculty profiles and assign them to departments and courses. Each faculty member gets a login automatically.",
        href: "/teachers",
      },
      {
        title: "Enrol students",
        description:
          "College students are placed via program/semester enrolments (not sections). Enrol existing student records, or import students first through the Data I/O center.",
        href: "/college/enrollments",
      },
      {
        title: "Configure fees",
        description:
          "Set up fee categories and schedules (with optional fines and discounts) so collections, receipts and dues reports work from day one.",
        href: "/fees/setup",
      },
    ],
    meta: meta(),
  },
  {
    id: "gs-daily-rhythm",
    title: "The daily rhythm",
    appliesTo: "both",
    steps: [
      {
        title: "Mark attendance",
        description:
          "Daily attendance per section/batch — present, absent, late or excused. Approved student leave marks the days excused automatically.",
        href: "/attendance",
      },
      {
        title: "Assign homework",
        description:
          "Teachers post homework per class/program with due dates; students and parents see it in their portal.",
        href: "/homework",
      },
      {
        title: "Communicate",
        description:
          "Send announcements to everyone or targeted messages to a class, section, batch or single student's guardians — delivered in-app, plus email when configured.",
        href: "/communication",
      },
      {
        title: "Watch the dashboard",
        description:
          "The dashboard surfaces today's attendance, fee dues and items needing attention; Reports Hub has the deeper cuts.",
        href: "/dashboard",
      },
    ],
    meta: meta(),
  },
];
