import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  app,
  createInstitution,
  createUser,
  query,
  resetDb,
  tokenFor,
} from "./helpers";

// PR-T4 — the tenant-admin overview summary (GET /dashboard/summary) and the
// lightweight tenant search (GET /search). These back the honest dashboard and
// the shell's global search. The suite asserts: real tenant-scoped values (no
// fakes), permission gating of money/admissions data, the needs-attention
// signals, staff-only + tenant isolation guards, and search behaviour/RBAC.

const PW = "Passw0rd!";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function insertId(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await query<{ id: string }>(sql, params);
  return rows[0].id;
}

describe("PR-T4 dashboard summary + tenant search", () => {
  let instA: string; // healthy school
  let instB: string; // empty school (needs-attention signals)
  let instC: string; // isolation probe (must never leak into A)
  const tok: Record<string, string> = {};

  beforeEach(async () => {
    await resetDb();

    // --- Institution A: a fully set-up school ------------------------------
    instA = await createInstitution("HZA", "school");
    await createUser({ email: "admin@hza.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "teacher@hza.dev", password: PW, role: "teacher", institutionId: instA });
    await createUser({ email: "student@hza.dev", password: PW, role: "student", institutionId: instA });
    await createUser({ email: "parent@hza.dev", password: PW, role: "parent", institutionId: instA });
    await createUser({ email: "super@hza.dev", password: PW, role: "super_admin", institutionId: null });

    // Tenant RBAC v2 overrides: deny this school's teacher role the money and
    // student-PII reads, so we exercise the summary/search permission gates
    // with a role that is still staff (passes requireStaff) but lacks the keys.
    for (const key of ["fees:read", "students:read"]) {
      await query(
        `INSERT INTO tenant_role_permissions (institution_id, role, permission_key, effect)
         VALUES ($1, 'teacher', $2, 'deny')`,
        [instA, key]
      );
    }

    await query(
      `INSERT INTO academic_years (institution_id, name, start_date, end_date, is_current)
       VALUES ($1, 'AY-A 2026-27', '2026-06-01', '2027-05-31', true)`,
      [instA]
    );

    const classNine = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'A-Grade Nine', 9) RETURNING id`,
      [instA]
    );
    const classTen = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'A-Grade Ten', 10) RETURNING id`,
      [instA]
    );
    const secNine = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1, $2, 'A') RETURNING id`,
      [instA, classNine]
    );
    await query(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1, $2, 'A')`,
      [instA, classTen]
    );
    await query(
      `INSERT INTO subjects (institution_id, name, code) VALUES ($1, 'A-Math', 'A-MATH'), ($1, 'A-Science', 'A-SCI')`,
      [instA]
    );

    // 3 active students (one distinctively named for search), 2 active teachers.
    const zoravar = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id, gender, status)
       VALUES ($1, 'HZA-1', 'Zoravar', 'Kingsley', $2, 'male', 'active') RETURNING id`,
      [instA, secNine]
    );
    await query(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id, status)
       VALUES ($1, 'HZA-2', 'Beatrix', 'Vale', $2, 'active'),
              ($1, 'HZA-3', 'Corin', 'Ashby', $2, 'active')`,
      [instA, secNine]
    );
    await query(
      `INSERT INTO teachers (institution_id, employee_no, first_name, last_name, is_active)
       VALUES ($1, 'HZA-T1', 'Merriwether', 'Falco', true),
              ($1, 'HZA-T2', 'Delphine', 'Ward', true)`,
      [instA]
    );

    // Attendance marked today (keeps A "healthy" — no attendance_not_marked signal).
    await query(
      `INSERT INTO attendance_records (institution_id, student_id, date, status)
       VALUES ($1, $2, CURRENT_DATE, 'present')`,
      [instA, zoravar]
    );

    // Admissions pipeline: 2 pending (enquiry/applied) counted, 1 admitted not.
    await query(
      `INSERT INTO admission_applications (institution_id, first_name, last_name, status)
       VALUES ($1, 'Pia', 'Nair', 'enquiry'),
              ($1, 'Rhys', 'Osei', 'applied'),
              ($1, 'Tomas', 'Reyes', 'admitted')`,
      [instA]
    );

    // One overdue invoice (due in the past, still pending) with a partial payment today.
    const inv = await insertId(
      `INSERT INTO invoices (institution_id, invoice_no, student_id, description, amount_due, due_date, status)
       VALUES ($1, 'INV-HZA-1', $2, 'Term 1', 1000, '2020-01-01', 'pending') RETURNING id`,
      [instA, zoravar]
    );
    await query(
      `INSERT INTO payments (institution_id, invoice_id, amount, method) VALUES ($1, $2, 400, 'cash')`,
      [instA, inv]
    );

    // --- Institution B: an empty school (should raise setup signals) -------
    instB = await createInstitution("HZB", "school");
    await createUser({ email: "admin@hzb.dev", password: PW, role: "admin", institutionId: instB });

    // --- Institution C: isolation probe -----------------------------------
    instC = await createInstitution("HZC", "school");
    await query(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, status)
       VALUES ($1, 'HZC-1', 'Qwynnedd', 'Blofeld', 'active')`,
      [instC]
    );

    tok.adminA = await tokenFor("admin@hza.dev", PW);
    tok.teacherA = await tokenFor("teacher@hza.dev", PW);
    tok.studentA = await tokenFor("student@hza.dev", PW);
    tok.parentA = await tokenFor("parent@hza.dev", PW);
    tok.superA = await tokenFor("super@hza.dev", PW);
    tok.adminB = await tokenFor("admin@hzb.dev", PW);
  });

  // ---- GET /dashboard/summary --------------------------------------------

  describe("GET /dashboard/summary", () => {
    it("requires auth, a tenant, and a staff role", async () => {
      expect((await request(app).get("/api/v1/dashboard/summary")).status).toBe(401);
      // super_admin is tenant-less → rejected by requireTenant.
      expect((await request(app).get("/api/v1/dashboard/summary").set(auth(tok.superA))).status).toBe(403);
      // student/parent are not staff → rejected by requireStaff.
      expect((await request(app).get("/api/v1/dashboard/summary").set(auth(tok.studentA))).status).toBe(403);
      expect((await request(app).get("/api/v1/dashboard/summary").set(auth(tok.parentA))).status).toBe(403);
    });

    it("returns real, tenant-scoped values for an admin (no fakes)", async () => {
      const res = await request(app).get("/api/v1/dashboard/summary").set(auth(tok.adminA));
      expect(res.status).toBe(200);
      const b = res.body;

      // Institution snapshot — sourced from the DB, not hardcoded.
      expect(b.institution.name).toBe("Institution HZA");
      expect(b.institution.type).toBe("school");
      expect(b.institution.isActive).toBe(true);
      expect(b.institution.currentAcademicYear?.name).toBe("AY-A 2026-27");

      // Academic counts reflect exactly what was inserted for this tenant.
      expect(b.academic.classes).toBe(2);
      expect(b.academic.sections).toBe(2);
      expect(b.academic.subjects).toBe(2);
      expect(b.academic.activeStudents).toBe(3); // NOT 4 — inst C's student excluded
      expect(b.academic.activeStaff).toBe(2);

      // Operations.
      expect(b.operations.attendanceToday.marked).toBe(1);
      expect(b.operations.attendanceToday.present).toBe(1);
      expect(b.operations.attendanceToday.rate).toBe(1);
      expect(b.operations.pendingAdmissions).toBe(2); // admin holds admissions:read
      expect(typeof b.operations.upcomingExams).toBe("number");

      // Finance — admin holds fees:read, so the section is present and correct.
      expect(b.finance).not.toBeNull();
      expect(b.finance.pendingInvoices).toBe(1);
      expect(b.finance.overdueInvoices).toBe(1);
      expect(b.finance.totalInvoiced).toBe(1000);
      expect(b.finance.totalCollected).toBe(400);
      expect(b.finance.outstanding).toBe(600);
      expect(b.finance.collectedToday).toBe(400);

      // Needs-attention: a healthy school raises none of the setup signals but
      // does flag the overdue fee (admin can see money signals).
      const keys: string[] = b.needsAttention.map((n: { key: string }) => n.key);
      expect(keys).not.toContain("no_academic_year");
      expect(keys).not.toContain("no_classes");
      expect(keys).not.toContain("no_students");
      expect(keys).toContain("overdue_fees");
      const overdue = b.needsAttention.find((n: { key: string }) => n.key === "overdue_fees");
      expect(overdue.count).toBe(1);

      expect(Array.isArray(b.communication.recentAnnouncements)).toBe(true);
    });

    it("hides money + admissions data from a role lacking those permissions", async () => {
      const res = await request(app).get("/api/v1/dashboard/summary").set(auth(tok.teacherA));
      expect(res.status).toBe(200);
      const b = res.body;

      // Gated to null for the deny-override'd / ungranted keys...
      expect(b.finance).toBeNull(); // fees:read denied for this tenant's teacher
      expect(b.operations.pendingAdmissions).toBeNull(); // teacher lacks admissions:read

      // ...but non-sensitive academic data is still fully visible (selective, not all-or-nothing).
      expect(b.academic.activeStudents).toBe(3);
      expect(b.institution.currentAcademicYear?.name).toBe("AY-A 2026-27");

      // A money signal must not leak into needs-attention for this role.
      const keys: string[] = b.needsAttention.map((n: { key: string }) => n.key);
      expect(keys).not.toContain("overdue_fees");
    });

    it("raises setup signals for an unconfigured tenant", async () => {
      const res = await request(app).get("/api/v1/dashboard/summary").set(auth(tok.adminB));
      expect(res.status).toBe(200);
      const b = res.body;

      expect(b.academic.classes).toBe(0);
      expect(b.academic.activeStudents).toBe(0);
      expect(b.institution.currentAcademicYear).toBeNull();

      const keys: string[] = b.needsAttention.map((n: { key: string }) => n.key);
      expect(keys).toContain("no_academic_year");
      expect(keys).toContain("no_classes");
      expect(keys).toContain("no_students");
    });
  });

  // ---- GET /search --------------------------------------------------------

  describe("GET /search", () => {
    it("requires auth, a tenant, and a staff role", async () => {
      expect((await request(app).get("/api/v1/search").query({ q: "Zoravar" })).status).toBe(401);
      expect(
        (await request(app).get("/api/v1/search").query({ q: "Zoravar" }).set(auth(tok.superA))).status
      ).toBe(403);
      expect(
        (await request(app).get("/api/v1/search").query({ q: "Zoravar" }).set(auth(tok.studentA))).status
      ).toBe(403);
    });

    it("rejects a too-short query", async () => {
      const res = await request(app).get("/api/v1/search").query({ q: "a" }).set(auth(tok.adminA));
      expect(res.status).toBe(400);
    });

    it("finds students, staff and classes for a permitted admin", async () => {
      const student = await request(app).get("/api/v1/search").query({ q: "Zoravar" }).set(auth(tok.adminA));
      expect(student.status).toBe(200);
      const sHit = student.body.results.find((r: { type: string }) => r.type === "student");
      expect(sHit.label).toBe("Zoravar Kingsley");
      expect(sHit.href).toBe("/students");

      const staff = await request(app).get("/api/v1/search").query({ q: "Merriwether" }).set(auth(tok.adminA));
      const tHit = staff.body.results.find((r: { type: string }) => r.type === "staff");
      expect(tHit.label).toBe("Merriwether Falco");
      expect(tHit.href).toBe("/teachers");

      const cls = await request(app).get("/api/v1/search").query({ q: "Grade Nine" }).set(auth(tok.adminA));
      const cHit = cls.body.results.find((r: { type: string }) => r.type === "class");
      expect(cHit.label).toBe("A-Grade Nine");
      expect(cHit.href).toBe("/classes");
    });

    it("omits student (PII) hits for a role lacking students:read", async () => {
      const res = await request(app).get("/api/v1/search").query({ q: "Zoravar" }).set(auth(tok.teacherA));
      expect(res.status).toBe(200);
      expect(res.body.results.some((r: { type: string }) => r.type === "student")).toBe(false);

      // The teacher can still find non-PII structure (staff/classes).
      const staff = await request(app).get("/api/v1/search").query({ q: "Merriwether" }).set(auth(tok.teacherA));
      expect(staff.body.results.some((r: { type: string }) => r.type === "staff")).toBe(true);
    });

    it("never returns another tenant's records", async () => {
      const res = await request(app).get("/api/v1/search").query({ q: "Qwynnedd" }).set(auth(tok.adminA));
      expect(res.status).toBe(200);
      expect(res.body.results.some((r: { type: string }) => r.type === "student")).toBe(false);
    });
  });
});
