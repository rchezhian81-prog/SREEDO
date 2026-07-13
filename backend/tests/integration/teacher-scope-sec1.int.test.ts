import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  app,
  createInstitution,
  createUser,
  query,
  resetDb,
  tokenFor,
} from "./helpers";
import { env } from "../../src/config/env";

// PR-SEC1 — teacher own-class row scoping. Proves: with ENFORCE_TEACHER_SCOPE on,
// a plain teacher is limited to sections they own (homeroom / class_subjects /
// timetable) for attendance, period attendance, exam marks and homework; a
// cross-section write is 403 and a list read is narrowed; admin and the
// broad-view (academics:all_sections) job-roles bypass; and with the flag off
// everything reverts to the pre-PR behaviour.

const PW = "Passw0rd!";

async function insertId(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await query<{ id: string }>(sql, params);
  return rows[0].id;
}

describe("teacher own-class row scoping (PR-SEC1)", () => {
  let inst: string;
  let sectionOwned: string;
  let sectionOther: string;
  let studentOwned: string;
  let studentOther: string;
  let subject: string;
  let period: string;
  let exam: string;
  const tok: Record<string, string> = {};

  const post = (path: string, token: string, body?: unknown) =>
    request(app)
      .post(`/api/v1${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body ?? {});
  const get = (path: string, token: string) =>
    request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${token}`);

  beforeEach(async () => {
    await resetDb();
    env.enforceTeacherScope = true;

    inst = await createInstitution("SEC1");
    await createUser({ email: "admin@sec1.dev", password: PW, role: "admin", institutionId: inst });
    tok.admin = await tokenFor("admin@sec1.dev", PW);

    // A plain teacher linked to a teachers row that is homeroom of `sectionOwned`.
    const { id: teacherUserId } = await createUser({
      email: "teacher@sec1.dev",
      password: PW,
      role: "teacher",
      institutionId: inst,
    });
    tok.teacher = await tokenFor("teacher@sec1.dev", PW);
    const teacherRec = await insertId(
      `INSERT INTO teachers (institution_id, employee_no, first_name, last_name, user_id, joining_date)
       VALUES ($1, 'EMP-1', 'Own', 'Teacher', $2, CURRENT_DATE) RETURNING id`,
      [inst, teacherUserId]
    );

    // A second teacher carrying the broad-view job-role (bypasses scoping).
    const { id: broadUserId } = await createUser({
      email: "controller@sec1.dev",
      password: PW,
      role: "teacher",
      institutionId: inst,
    });
    await query("UPDATE users SET job_role_key = 'jr_exam_controller' WHERE id = $1", [broadUserId]);
    tok.controller = await tokenFor("controller@sec1.dev", PW);

    const klass = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'Grade 1', 1) RETURNING id`,
      [inst]
    );
    // Owned via homeroom; the other section belongs to nobody the teacher owns.
    sectionOwned = await insertId(
      `INSERT INTO sections (institution_id, class_id, name, homeroom_teacher_id) VALUES ($1, $2, 'A', $3) RETURNING id`,
      [inst, klass, teacherRec]
    );
    sectionOther = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1, $2, 'B') RETURNING id`,
      [inst, klass]
    );
    studentOwned = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, gender, section_id)
       VALUES ($1, 'ADM-1', 'Ann', 'Owned', 'female', $2) RETURNING id`,
      [inst, sectionOwned]
    );
    studentOther = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, gender, section_id)
       VALUES ($1, 'ADM-2', 'Bob', 'Other', 'male', $2) RETURNING id`,
      [inst, sectionOther]
    );
    subject = await insertId(
      `INSERT INTO subjects (institution_id, name, code) VALUES ($1, 'Mathematics', 'MATH') RETURNING id`,
      [inst]
    );
    period = await insertId(
      `INSERT INTO periods (institution_id, name, start_time, end_time, sort_order)
       VALUES ($1, 'P1', '08:00', '08:45', 1) RETURNING id`,
      [inst]
    );
    exam = await insertId(
      `INSERT INTO exams (institution_id, name) VALUES ($1, 'Mid-term') RETURNING id`,
      [inst]
    );
  });

  afterEach(() => {
    env.enforceTeacherScope = false;
  });

  // --- /teaching-scope resolver --------------------------------------------

  it("reports a scoped teacher's owned sections and admin as unrestricted", async () => {
    const teacher = await get("/teaching-scope", tok.teacher);
    expect(teacher.status).toBe(200);
    expect(teacher.body.unrestricted).toBe(false);
    expect(teacher.body.sectionIds).toEqual([sectionOwned]);

    const admin = await get("/teaching-scope", tok.admin);
    expect(admin.body.unrestricted).toBe(true);

    const controller = await get("/teaching-scope", tok.controller);
    expect(controller.body.unrestricted).toBe(true); // broad-view permission
  });

  // --- Attendance -----------------------------------------------------------

  it("attendance: own students 200, cross-section write 403 + audited", async () => {
    const ok = await post("/attendance", tok.teacher, {
      date: "2026-07-13",
      records: [{ studentId: studentOwned, status: "present" }],
    });
    expect(ok.status).toBe(200);

    const denied = await post("/attendance", tok.teacher, {
      date: "2026-07-13",
      records: [{ studentId: studentOther, status: "present" }],
    });
    expect(denied.status).toBe(403);

    const { rows } = await query<{ n: string }>(
      "SELECT count(*) AS n FROM platform_audit_log WHERE action = 'teacher_scope.denied' AND institution_id = $1",
      [inst]
    );
    expect(Number(rows[0].n)).toBeGreaterThanOrEqual(1);
  });

  it("attendance: an explicit foreign section roster is 403; unfiltered is narrowed", async () => {
    const foreign = await get(`/attendance?sectionId=${sectionOther}`, tok.teacher);
    expect(foreign.status).toBe(403);

    const own = await get(`/attendance?sectionId=${sectionOwned}`, tok.teacher);
    expect(own.status).toBe(200);

    const all = await get("/attendance", tok.teacher);
    expect(all.status).toBe(200);
    const ids = (all.body.records as { studentId: string }[]).map((r) => r.studentId);
    expect(ids).toContain(studentOwned);
    expect(ids).not.toContain(studentOther);
  });

  // --- Exam marks -----------------------------------------------------------

  it("exams: marks for own section 200, cross-section 403", async () => {
    const ok = await post(`/exams/${exam}/results`, tok.teacher, {
      results: [{ studentId: studentOwned, subjectId: subject, marksObtained: 80 }],
    });
    expect(ok.status).toBe(200);

    const denied = await post(`/exams/${exam}/results`, tok.teacher, {
      results: [{ studentId: studentOther, subjectId: subject, marksObtained: 80 }],
    });
    expect(denied.status).toBe(403);
  });

  // --- Period attendance ----------------------------------------------------

  it("period attendance: own section 200, cross-section roster + mark 403", async () => {
    const roster = await get(
      `/period-attendance/roster?sectionId=${sectionOther}&date=2026-07-13&periodId=${period}`,
      tok.teacher
    );
    expect(roster.status).toBe(403);

    const ok = await post("/period-attendance", tok.teacher, {
      date: "2026-07-13",
      periodId: period,
      entries: [{ studentId: studentOwned, status: "present" }],
    });
    expect(ok.status).toBe(200);

    const denied = await post("/period-attendance", tok.teacher, {
      date: "2026-07-13",
      periodId: period,
      entries: [{ studentId: studentOther, status: "present" }],
    });
    expect(denied.status).toBe(403);
  });

  // --- Homework -------------------------------------------------------------

  it("homework: create for own section 201, cross-section 403", async () => {
    const ok = await post("/homework", tok.teacher, {
      sectionId: sectionOwned,
      subjectId: subject,
      title: "Own homework",
    });
    expect(ok.status).toBe(201);

    const denied = await post("/homework", tok.teacher, {
      sectionId: sectionOther,
      subjectId: subject,
      title: "Foreign homework",
    });
    expect(denied.status).toBe(403);
  });

  // --- Bypass paths ---------------------------------------------------------

  it("admin and broad-view controller bypass scoping (write any section)", async () => {
    // admin holds attendance:mark + the broad-view permission.
    const adminWrite = await post("/attendance", tok.admin, {
      date: "2026-07-13",
      records: [{ studentId: studentOther, status: "present" }],
    });
    expect(adminWrite.status).toBe(200);

    // The exam controller holds exams:enter_marks + academics:all_sections, so
    // it may enter marks for a section it does not "own".
    const controllerWrite = await post(`/exams/${exam}/results`, tok.controller, {
      results: [{ studentId: studentOther, subjectId: subject, marksObtained: 55 }],
    });
    expect(controllerWrite.status).toBe(200);
  });

  // --- Kill-switch off = behavioural no-op ----------------------------------

  it("with the kill-switch off, a teacher may write any section again", async () => {
    env.enforceTeacherScope = false;
    const res = await post("/attendance", tok.teacher, {
      date: "2026-07-13",
      records: [{ studentId: studentOther, status: "present" }],
    });
    expect(res.status).toBe(200);

    const scope = await get("/teaching-scope", tok.teacher);
    expect(scope.body.unrestricted).toBe(true);
  });
});
