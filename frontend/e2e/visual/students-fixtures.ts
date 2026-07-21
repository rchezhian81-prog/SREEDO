import type { Page } from "@playwright/test";

/**
 * PR-UI6 — deterministic, privacy-safe Students fixtures.
 *
 * Three synthetic staff personas — a School administrator (populated), a College
 * administrator (populated), and a School empty-state — each with a fixed
 * session, full student permissions and hard-coded, obviously-synthetic list
 * data. NO production API/DB, and NO real student names, admission numbers,
 * photos, contacts or identifiers ever appear here or in any artifact.
 */

export type PersonaKey = "schoolAdmin" | "collegeAdmin" | "empty";

const STUDENT_PERMS = [
  "students:read", "students:create", "students:update", "students:delete",
  "students:import", "students:promote",
];
const OTHER_READS = [
  "fees:read", "attendance:read", "exams:read", "staff:read", "timetable:read",
  "communication:read", "reports:read", "academics:read", "admissions:read",
];
const FULL_PERMS = [...STUDENT_PERMS, ...OTHER_READS, "academic_years:manage"];

const ENABLED_MODULES = [
  "students", "fees", "attendance", "exams", "staff", "timetable", "communication",
  "reports", "academics", "admissions",
];

// Synthetic school students — fake names, fake admission nos, fake phones.
const SCHOOL_STUDENTS = [
  { id: "s1", admissionNo: "ADM-1001", firstName: "Asha", lastName: "Rao", className: "Grade 5", sectionName: "A", guardianName: "Ramesh Rao", guardianRelation: "father", guardianPhone: "90000 00001", status: "active" },
  { id: "s2", admissionNo: "ADM-1002", firstName: "Vikram", lastName: "Nair", className: "Grade 5", sectionName: "A", guardianName: "Latha Nair", guardianRelation: "mother", guardianPhone: "90000 00002", status: "active" },
  { id: "s3", admissionNo: "ADM-1003", firstName: "Meera", lastName: "Iyer", className: "Grade 6", sectionName: "B", guardianName: "Suresh Iyer", guardianRelation: "father", guardianPhone: "90000 00003", status: "active" },
  { id: "s4", admissionNo: "ADM-1004", firstName: "Arjun", lastName: "Menon", className: "Grade 6", sectionName: "B", guardianName: "Priya Menon", guardianRelation: "mother", guardianPhone: "90000 00004", status: "inactive" },
  { id: "s5", admissionNo: "ADM-1005", firstName: "Divya", lastName: "Pillai", className: "Grade 7", sectionName: "A", guardianName: "Gopal Pillai", guardianRelation: "guardian", guardianPhone: "90000 00005", status: "active" },
  { id: "s6", admissionNo: "ADM-1006", firstName: "Karthik", lastName: "Shetty", className: "Grade 7", sectionName: "A", guardianName: "Anita Shetty", guardianRelation: "mother", guardianPhone: "90000 00006", status: "active" },
];

// Synthetic college students — placed via enrollment (no class/section).
const COLLEGE_STUDENTS = [
  { id: "c1", admissionNo: "REG-2001", firstName: "Nisha", lastName: "Verma", guardianName: "Om Verma", guardianRelation: "father", guardianPhone: "90000 01001", status: "active" },
  { id: "c2", admissionNo: "REG-2002", firstName: "Rahul", lastName: "Bose", guardianName: "Sunita Bose", guardianRelation: "mother", guardianPhone: "90000 01002", status: "active" },
  { id: "c3", admissionNo: "REG-2003", firstName: "Farah", lastName: "Khan", guardianName: "Imran Khan", guardianRelation: "father", guardianPhone: "90000 01003", status: "active" },
  { id: "c4", admissionNo: "REG-2004", firstName: "Dev", lastName: "Kapoor", guardianName: "Rita Kapoor", guardianRelation: "guardian", guardianPhone: "90000 01004", status: "inactive" },
  { id: "c5", admissionNo: "REG-2005", firstName: "Sara", lastName: "Dutta", guardianName: "Alok Dutta", guardianRelation: "father", guardianPhone: "90000 01005", status: "active" },
  { id: "c6", admissionNo: "REG-2006", firstName: "Imran", lastName: "Sheikh", guardianName: "Nadia Sheikh", guardianRelation: "mother", guardianPhone: "90000 01006", status: "active" },
];

const COLLEGE_ENROLLMENTS = [
  { studentId: "c1", programName: "B.Tech CSE", semesterName: "Semester 5" },
  { studentId: "c2", programName: "B.Tech ECE", semesterName: "Semester 3" },
  { studentId: "c3", programName: "B.Com", semesterName: "Semester 4" },
  { studentId: "c4", programName: "B.Tech CSE", semesterName: "Semester 1" },
  { studentId: "c5", programName: "BBA", semesterName: "Semester 2" },
  { studentId: "c6", programName: "B.Tech ECE", semesterName: "Semester 5" },
];

const SCHOOL_CLASSES = [
  { id: "cl5", name: "Grade 5", grade_level: 5, sections: [{ id: "sec5a", name: "A" }, { id: "sec5b", name: "B" }] },
  { id: "cl6", name: "Grade 6", grade_level: 6, sections: [{ id: "sec6a", name: "A" }, { id: "sec6b", name: "B" }] },
  { id: "cl7", name: "Grade 7", grade_level: 7, sections: [{ id: "sec7a", name: "A" }] },
];
const COLLEGE_PROGRAMS = [
  { id: "p1", name: "B.Tech CSE" },
  { id: "p2", name: "B.Tech ECE" },
  { id: "p3", name: "B.Com" },
];
const COLLEGE_SEMESTERS = [
  { id: "sem1", programId: "p1", name: "Semester 1" },
  { id: "sem5", programId: "p1", name: "Semester 5" },
  { id: "sem3", programId: "p2", name: "Semester 3" },
];

type Persona = {
  mode: "school" | "college";
  institutionType: "school" | "college";
  institutionName: string;
  students: unknown[];
};

export const PERSONAS: Record<PersonaKey, Persona> = {
  schoolAdmin: { mode: "school", institutionType: "school", institutionName: "Demo Public School", students: SCHOOL_STUDENTS },
  collegeAdmin: { mode: "college", institutionType: "college", institutionName: "Demo Institute of Technology", students: COLLEGE_STUDENTS },
  empty: { mode: "school", institutionType: "school", institutionName: "Demo Public School", students: [] },
};

const USER = (p: Persona, key: PersonaKey) => ({
  id: `00000000-0000-0000-0000-0000000000${key === "collegeAdmin" ? "bb" : "aa"}`,
  email: "staff.admin@example.test",
  fullName: "Demo Admin",
  role: "admin",
  institutionId: `00000000-0000-0000-0000-0000000000${key === "collegeAdmin" ? "bb" : "aa"}`,
  institutionName: p.institutionName,
  institutionType: p.institutionType,
});

/** Seed the persisted session, explicit theme, and campus mode before app JS. */
export async function seedSession(page: Page, opts: { persona: PersonaKey; dark: boolean }) {
  const p = PERSONAS[opts.persona];
  const user = USER(p, opts.persona);
  await page.addInitScript(
    ([u, mode, dark]) => {
      localStorage.setItem(
        "sreedo-auth",
        JSON.stringify({
          state: { user: u, accessToken: "visual-fixture-token", refreshToken: "visual-fixture-refresh", support: null },
          version: 0,
        })
      );
      localStorage.setItem("sreedo-mode", JSON.stringify({ state: { mode, hasChosen: true }, version: 0 }));
      localStorage.setItem("gocampus-theme", dark ? "dark" : "light");
    },
    [user, p.mode, opts.dark] as const
  );
}

/** Stub every shell + Students API call; `uiV2` drives the audited tenant flag. */
export async function installStudentsMocks(page: Page, opts: { persona: PersonaKey; uiV2: boolean }) {
  const p = PERSONAS[opts.persona];
  const user = USER(p, opts.persona);
  await page.route("**/api/v1/**", async (route) => {
    const url = route.request().url();
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

    // Shell
    if (url.includes("/auth/me"))
      return json({ ...user, enabledModules: ENABLED_MODULES, twoFactorEnabled: false, uiV2Enabled: opts.uiV2 });
    if (url.includes("/auth/permissions")) return json({ role: user.role, permissions: FULL_PERMS });
    if (url.includes("/branding"))
      return json({ displayName: p.institutionName, logoUrl: null, primaryColor: null, tagline: "Excellence in Education" });
    if (url.includes("/academic-years")) return json([{ id: "yr1", name: "2026-27", isCurrent: true }]);
    if (url.includes("/communication/inbox/unread-count")) return json({ count: 0 });

    // Students page
    if (url.includes("/students")) return json({ data: p.students, meta: { total: p.students.length, page: 1, limit: 10 } });
    if (url.includes("/college/enrollments")) return json(COLLEGE_ENROLLMENTS);
    if (url.includes("/college/programs")) return json(COLLEGE_PROGRAMS);
    if (url.includes("/college/semesters")) return json(COLLEGE_SEMESTERS);
    if (url.includes("/classes")) return json(SCHOOL_CLASSES);
    if (url.includes("/search")) return json({ results: [] });

    // Anything else must NOT be requested — abort so a stray call can never leak
    // data or make the screenshot non-deterministic.
    return route.abort();
  });
}
