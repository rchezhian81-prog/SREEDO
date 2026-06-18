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

const PW = "Passw0rd!";

async function insertId(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await query<{ id: string }>(sql, params);
  return rows[0].id;
}

async function seedGradeBands(institutionId: string): Promise<void> {
  const bands: Array<[string, number, number, number, number]> = [
    ["A+", 90, 100, 10, 1],
    ["A", 80, 90, 9, 2],
    ["B", 70, 80, 8, 3],
    ["C", 60, 70, 7, 4],
    ["D", 50, 60, 6, 5],
    ["F", 0, 50, 0, 6],
  ];
  for (const [grade, lo, hi, gp, order] of bands) {
    await query(
      `INSERT INTO grade_bands (institution_id, grade, min_percent, max_percent, grade_point, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [institutionId, grade, lo, hi, gp, order]
    );
  }
}

describe("college mode", () => {
  let instA: string;
  let instB: string;
  let teacherRec: string;
  let subjMath: string;
  let subjPhys: string;
  let st1: string; // linked to the student user
  let st2: string; // another student (not linked)
  const tok: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (path: string, t: string) => request(app).get(path).set(auth(t));
  const post = (path: string, t: string, body: unknown) =>
    request(app).post(path).set(auth(t)).send(body);
  const patch = (path: string, t: string, body: unknown) =>
    request(app).patch(path).set(auth(t)).send(body);
  const del = (path: string, t: string) => request(app).delete(path).set(auth(t));

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("CLG", "college");

    await createUser({ email: "admin@clg.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "teacher@clg.dev", password: PW, role: "teacher", institutionId: instA });
    await createUser({ email: "accountant@clg.dev", password: PW, role: "accountant", institutionId: instA });
    const studentUser = await createUser({ email: "student@clg.dev", password: PW, role: "student", institutionId: instA });
    const parentUser = await createUser({ email: "parent@clg.dev", password: PW, role: "parent", institutionId: instA });

    teacherRec = await insertId(
      `INSERT INTO teachers (institution_id, employee_no, first_name, last_name) VALUES ($1, 'EMP-1', 'Dr', 'Rao') RETURNING id`,
      [instA]
    );
    subjMath = await insertId(
      `INSERT INTO subjects (institution_id, name, code) VALUES ($1, 'Calculus', 'MATH') RETURNING id`,
      [instA]
    );
    subjPhys = await insertId(
      `INSERT INTO subjects (institution_id, name, code) VALUES ($1, 'Physics', 'PHY') RETURNING id`,
      [instA]
    );
    st1 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, user_id) VALUES ($1, 'CLG-1', 'Asha', 'K', $2) RETURNING id`,
      [instA, studentUser.id]
    );
    st2 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name) VALUES ($1, 'CLG-2', 'Bala', 'M') RETURNING id`,
      [instA]
    );
    await query(
      `INSERT INTO guardians (institution_id, user_id, student_id, relationship) VALUES ($1, $2, $3, 'mother')`,
      [instA, parentUser.id, st1]
    );
    await seedGradeBands(instA);

    instB = await createInstitution("CLG2", "college");
    await createUser({ email: "admin@clg2.dev", password: PW, role: "admin", institutionId: instB });

    for (const r of ["admin", "teacher", "accountant", "student", "parent"])
      tok[r] = await tokenFor(`${r}@clg.dev`, PW);
    tok.badmin = await tokenFor("admin@clg2.dev", PW);
  });

  it("builds the college structure end-to-end and reports an overview", async () => {
    const dept = await post("/api/v1/college/departments", tok.admin, {
      name: "Computer Science",
      code: "CS",
      headTeacherId: teacherRec,
    });
    expect(dept.status).toBe(201);

    const prog = await post("/api/v1/college/programs", tok.admin, {
      departmentId: dept.body.id,
      name: "B.Sc CS",
      code: "BSCS",
      durationSemesters: 6,
    });
    expect(prog.status).toBe(201);

    const sem = await post("/api/v1/college/semesters", tok.admin, {
      programId: prog.body.id,
      name: "Semester 1",
      number: 1,
    });
    expect(sem.status).toBe(201);

    const batch = await post("/api/v1/college/batches", tok.admin, {
      programId: prog.body.id,
      name: "2026-2029",
      startYear: 2026,
    });
    expect(batch.status).toBe(201);

    const ps = await post("/api/v1/college/program-subjects", tok.admin, {
      programId: prog.body.id,
      semesterId: sem.body.id,
      subjectId: subjMath,
      credits: 4,
    });
    expect(ps.status).toBe(201);

    const enr = await post("/api/v1/college/enrollments", tok.admin, {
      studentId: st1,
      programId: prog.body.id,
      semesterId: sem.body.id,
      batchId: batch.body.id,
    });
    expect(enr.status).toBe(201);

    const alloc = await post("/api/v1/college/staff-allocations", tok.admin, {
      teacherId: teacherRec,
      departmentId: dept.body.id,
      programId: prog.body.id,
      subjectId: subjMath,
    });
    expect(alloc.status).toBe(201);

    const overview = await get("/api/v1/college/overview", tok.admin);
    expect(overview.status).toBe(200);
    expect(overview.body).toMatchObject({
      type: "college",
      departments: 1,
      programs: 1,
      semesters: 1,
      enrollments: 1,
    });

    // Department list resolves head teacher + program count.
    const depts = await get("/api/v1/college/departments", tok.admin);
    expect(depts.body[0]).toMatchObject({ code: "CS", programCount: 1 });
    expect(depts.body[0].headTeacherName).toContain("Rao");
  });

  it("rejects duplicates and validates references", async () => {
    const dept = await post("/api/v1/college/departments", tok.admin, { name: "CS", code: "CS" });
    expect((await post("/api/v1/college/departments", tok.admin, { name: "Dup", code: "CS" })).status).toBe(409);

    // Program under a non-existent department → 400.
    const bad = await post("/api/v1/college/programs", tok.admin, {
      departmentId: "00000000-0000-0000-0000-000000000000",
      name: "X",
      code: "X",
    });
    expect(bad.status).toBe(400);

    const prog = await post("/api/v1/college/programs", tok.admin, {
      departmentId: dept.body.id,
      name: "B.Sc",
      code: "BSC",
    });
    await post("/api/v1/college/semesters", tok.admin, { programId: prog.body.id, name: "S1", number: 1 });
    // Duplicate semester number for the program → 409.
    expect(
      (await post("/api/v1/college/semesters", tok.admin, { programId: prog.body.id, name: "S1 again", number: 1 })).status
    ).toBe(409);
  });

  it("computes GPA and CGPA from semester-tagged exam results", async () => {
    const dept = await post("/api/v1/college/departments", tok.admin, { name: "CS", code: "CS" });
    const prog = await post("/api/v1/college/programs", tok.admin, {
      departmentId: dept.body.id,
      name: "B.Sc",
      code: "BSC",
    });
    const sem = await post("/api/v1/college/semesters", tok.admin, {
      programId: prog.body.id,
      name: "S1",
      number: 1,
    });
    await post("/api/v1/college/program-subjects", tok.admin, {
      programId: prog.body.id,
      semesterId: sem.body.id,
      subjectId: subjMath,
      credits: 4,
    });
    await post("/api/v1/college/program-subjects", tok.admin, {
      programId: prog.body.id,
      semesterId: sem.body.id,
      subjectId: subjPhys,
      credits: 3,
    });
    await post("/api/v1/college/enrollments", tok.admin, {
      studentId: st1,
      programId: prog.body.id,
      semesterId: sem.body.id,
    });

    // Exam tagged to the semester; Math 90% (A+, gp 10), Physics 70% (B, gp 8).
    const exam = await insertId(
      `INSERT INTO exams (institution_id, name, semester_id) VALUES ($1, 'Sem 1 Final', $2) RETURNING id`,
      [instA, sem.body.id]
    );
    await query(
      `INSERT INTO exam_results (institution_id, exam_id, student_id, subject_id, marks_obtained, max_marks) VALUES ($1,$2,$3,$4,90,100)`,
      [instA, exam, st1, subjMath]
    );
    await query(
      `INSERT INTO exam_results (institution_id, exam_id, student_id, subject_id, marks_obtained, max_marks) VALUES ($1,$2,$3,$4,70,100)`,
      [instA, exam, st1, subjPhys]
    );

    const result = await get(`/api/v1/college/students/${st1}/semesters/${sem.body.id}/result`, tok.admin);
    expect(result.status).toBe(200);
    expect(result.body.totalCredits).toBe(7);
    // (4*10 + 3*8) / 7 = 9.142857 → 9.14
    expect(result.body.gpa).toBeCloseTo(9.14, 2);
    expect(result.body.subjects).toHaveLength(2);

    const cgpa = await get(`/api/v1/college/students/${st1}/cgpa?programId=${prog.body.id}`, tok.admin);
    expect(cgpa.status).toBe(200);
    expect(cgpa.body.cgpa).toBeCloseTo(9.14, 2);
    expect(cgpa.body.totalCredits).toBe(7);
    expect(cgpa.body.perSemester).toHaveLength(1);
  });

  it("owner-scopes student result views", async () => {
    const dept = await post("/api/v1/college/departments", tok.admin, { name: "CS", code: "CS" });
    const prog = await post("/api/v1/college/programs", tok.admin, {
      departmentId: dept.body.id,
      name: "B.Sc",
      code: "BSC",
    });
    const sem = await post("/api/v1/college/semesters", tok.admin, {
      programId: prog.body.id,
      name: "S1",
      number: 1,
    });

    // The student may read their own result, and a parent their child's.
    expect((await get(`/api/v1/college/students/${st1}/semesters/${sem.body.id}/result`, tok.student)).status).toBe(200);
    expect((await get(`/api/v1/college/students/${st1}/semesters/${sem.body.id}/result`, tok.parent)).status).toBe(200);
    // …but not another student's.
    expect((await get(`/api/v1/college/students/${st2}/semesters/${sem.body.id}/result`, tok.student)).status).toBe(403);
    expect((await get(`/api/v1/college/students/${st2}/cgpa?programId=${prog.body.id}`, tok.student)).status).toBe(403);
  });

  it("enforces permission guards", async () => {
    // Teacher: reads structure, cannot create or change mode.
    expect((await get("/api/v1/college/overview", tok.teacher)).status).toBe(200);
    expect((await get("/api/v1/college/departments", tok.teacher)).status).toBe(200);
    expect((await post("/api/v1/college/departments", tok.teacher, { name: "X", code: "X" })).status).toBe(403);
    expect((await patch("/api/v1/college/settings", tok.teacher, { type: "school" })).status).toBe(403);

    // Accountant: read-only structure access.
    expect((await get("/api/v1/college/overview", tok.accountant)).status).toBe(200);

    // Student: no college access at all.
    expect((await get("/api/v1/college/overview", tok.student)).status).toBe(403);
    expect((await get("/api/v1/college/departments", tok.student)).status).toBe(403);

    // Admin: full access incl. mode switch.
    expect((await patch("/api/v1/college/settings", tok.admin, { type: "college" })).status).toBe(200);
  });

  it("is tenant-scoped (no cross-institution access)", async () => {
    const a = await post("/api/v1/college/departments", tok.admin, { name: "A Dept", code: "AD" });
    const b = await post("/api/v1/college/departments", tok.badmin, { name: "B Dept", code: "BD" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const aList = await get("/api/v1/college/departments", tok.admin);
    expect(aList.body.map((d: { code: string }) => d.code)).toEqual(["AD"]);
    const bList = await get("/api/v1/college/departments", tok.badmin);
    expect(bList.body.map((d: { code: string }) => d.code)).toEqual(["BD"]);

    // Admin A cannot mutate/delete institution B's department (scoped → 404).
    expect((await patch(`/api/v1/college/departments/${b.body.id}`, tok.admin, { name: "Hijack" })).status).toBe(404);
    expect((await del(`/api/v1/college/departments/${b.body.id}`, tok.admin)).status).toBe(404);
    // B's record is untouched.
    expect((await get("/api/v1/college/departments", tok.badmin)).body[0].name).toBe("B Dept");
  });

  it("keeps school mode working (no regression)", async () => {
    const school = await createInstitution("SKL", "school");
    await createUser({ email: "admin@skl.dev", password: PW, role: "admin", institutionId: school });
    const sAdmin = await tokenFor("admin@skl.dev", PW);

    // Existing school endpoints still function under a school tenant.
    const years = await get("/api/v1/academic-years", sAdmin);
    expect(years.status).toBe(200);
    const cls = await post("/api/v1/classes", sAdmin, { name: "Grade 5", gradeLevel: 5 });
    expect(cls.status).toBe(201);

    // College overview reports a school with an empty structure.
    const overview = await get("/api/v1/college/overview", sAdmin);
    expect(overview.body).toMatchObject({ type: "school", departments: 0, programs: 0 });

    // An admin can opt a school into college mode for their own tenant only.
    const flip = await patch("/api/v1/college/settings", sAdmin, { type: "college" });
    expect(flip.body.type).toBe("college");
    expect((await get("/api/v1/college/overview", sAdmin)).body.type).toBe("college");
  });
});
