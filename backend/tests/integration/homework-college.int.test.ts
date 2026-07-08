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

// PR-T3 — Homework college/semester variant. A homework row targets either a
// section (school, covered by homework.int.test.ts) or a semester (college,
// here). College students carry no section; their cohort is an active
// enrollment's semester.
const PW = "Passw0rd!";
const PDF = Buffer.from("%PDF-1.4\ncollege-hw\n%%EOF");
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

async function insertId(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await query<{ id: string }>(sql, params);
  return rows[0].id;
}

describe("homework — college (semester) variant", () => {
  let instA: string;
  let sem1: string;
  let sem2: string;
  let subj: string;
  let hwSem1: string; // a homework on semester 1
  const tok: Record<string, string> = {};

  const post = (path: string, token: string, body?: unknown) =>
    request(app).post(path).set("Authorization", `Bearer ${token}`).send(body ?? {});
  const get = (path: string, token: string) =>
    request(app).get(path).set("Authorization", `Bearer ${token}`);

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("HCLG", "college");
    for (const role of ["admin", "teacher", "accountant"] as const) {
      await createUser({ email: `${role}@hc.dev`, password: PW, role, institutionId: instA });
    }
    const su1 = await createUser({ email: "su1@hc.dev", password: PW, role: "student", institutionId: instA });
    const su2 = await createUser({ email: "su2@hc.dev", password: PW, role: "student", institutionId: instA });
    const pu1 = await createUser({ email: "pu1@hc.dev", password: PW, role: "parent", institutionId: instA });

    const dept = await insertId(
      `INSERT INTO departments (institution_id, name, code) VALUES ($1, 'CS', 'CS') RETURNING id`,
      [instA]
    );
    const prog = await insertId(
      `INSERT INTO programs (institution_id, department_id, name, code, duration_semesters)
       VALUES ($1, $2, 'B.Sc CS', 'BSCS', 6) RETURNING id`,
      [instA, dept]
    );
    sem1 = await insertId(
      `INSERT INTO semesters (institution_id, program_id, name, number) VALUES ($1, $2, 'Semester 1', 1) RETURNING id`,
      [instA, prog]
    );
    sem2 = await insertId(
      `INSERT INTO semesters (institution_id, program_id, name, number) VALUES ($1, $2, 'Semester 2', 2) RETURNING id`,
      [instA, prog]
    );
    subj = await insertId(
      `INSERT INTO subjects (institution_id, name, code) VALUES ($1, 'Calculus', 'MATH') RETURNING id`,
      [instA]
    );
    // College students have no section; their cohort is an active enrollment.
    const st1 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, user_id) VALUES ($1, 'HC-1', 'Asha', 'K', $2) RETURNING id`,
      [instA, su1.id]
    );
    const st2 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, user_id) VALUES ($1, 'HC-2', 'Bala', 'M', $2) RETURNING id`,
      [instA, su2.id]
    );
    await query(
      `INSERT INTO enrollments (institution_id, student_id, program_id, semester_id, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [instA, st1, prog, sem1]
    );
    await query(
      `INSERT INTO enrollments (institution_id, student_id, program_id, semester_id, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [instA, st2, prog, sem2]
    );
    await query(
      `INSERT INTO guardians (institution_id, user_id, student_id, relationship) VALUES ($1, $2, $3, 'mother')`,
      [instA, pu1.id, st1]
    );

    for (const e of ["admin", "teacher", "accountant"]) tok[e] = await tokenFor(`${e}@hc.dev`, PW);
    tok.su1 = await tokenFor("su1@hc.dev", PW);
    tok.su2 = await tokenFor("su2@hc.dev", PW);
    tok.pu1 = await tokenFor("pu1@hc.dev", PW);

    // College homework for semester 1 (created by the teacher).
    const created = await post("/api/v1/homework", tok.teacher, {
      semesterId: sem1,
      subjectId: subj,
      title: "Calculus problem set",
      description: "Solve all.",
      dueDate: "2030-12-31",
      maxMarks: 20,
    });
    expect(created.status).toBe(201);
    hwSem1 = created.body.id;
  });

  it("carries semester + program metadata and no section", async () => {
    const detail = await get(`/api/v1/homework/${hwSem1}`, tok.teacher);
    expect(detail.status).toBe(200);
    expect(detail.body.semesterId).toBe(sem1);
    expect(detail.body.semesterName).toBe("Semester 1");
    expect(detail.body.programName).toBe("B.Sc CS");
    expect(detail.body.sectionId).toBeNull();
  });

  it("notifies the semester's students when college homework is assigned", async () => {
    const inbox = await get("/api/v1/communication/inbox", tok.su1);
    expect(inbox.status).toBe(200);
    expect(
      inbox.body.some((m: { subject: string }) => m.subject.includes("Calculus problem set"))
    ).toBe(true);
  });

  it("scopes by semester: only that semester's student/parent see it", async () => {
    expect((await get("/api/v1/homework", tok.su1)).body).toHaveLength(1); // sem 1 student
    expect((await get("/api/v1/homework", tok.pu1)).body).toHaveLength(1); // parent of sem 1 student
    expect((await get("/api/v1/homework", tok.su2)).body).toHaveLength(0); // sem 2 student
    expect((await get(`/api/v1/homework/${hwSem1}`, tok.su2)).status).toBe(403);
  });

  it("lets an enrolled student submit and the teacher grade it; blocks other semesters", async () => {
    const submit = await request(app)
      .post(`/api/v1/homework/${hwSem1}/submit`)
      .set("Authorization", `Bearer ${tok.su1}`)
      .field("content", "My working")
      .attach("file", PDF, { filename: "ans.pdf", contentType: "application/pdf" });
    expect(submit.status).toBe(201);
    expect(submit.body.status).toBe("submitted");

    // A student enrolled in a different semester cannot submit.
    expect((await post(`/api/v1/homework/${hwSem1}/submit`, tok.su2)).status).toBe(403);

    const subs = await get(`/api/v1/homework/${hwSem1}/submissions`, tok.teacher);
    expect(subs.status).toBe(200);
    expect(subs.body).toHaveLength(1);

    const review = await post(
      `/api/v1/homework/submissions/${subs.body[0].id}/review`,
      tok.teacher,
      { status: "completed", marks: 18, remarks: "Good" }
    );
    expect(review.status).toBe(200);
    expect(review.body.status).toBe("completed");
    expect(Number(review.body.marks)).toBe(18);
  });

  it("filters homework by semester for staff", async () => {
    expect((await get(`/api/v1/homework?semesterId=${sem1}`, tok.admin)).body).toHaveLength(1);
    expect((await get(`/api/v1/homework?semesterId=${sem2}`, tok.admin)).body).toHaveLength(0);
  });

  it("requires exactly one cohort target", async () => {
    // Neither section nor semester → 400 (schema one-of refinement).
    expect((await post("/api/v1/homework", tok.teacher, { subjectId: subj, title: "x" })).status).toBe(400);
    // Both → 400.
    expect(
      (
        await post("/api/v1/homework", tok.teacher, {
          subjectId: subj,
          semesterId: sem1,
          sectionId: NIL_UUID,
          title: "x",
        })
      ).status
    ).toBe(400);
    // A semester that does not exist → 400 (assertRef).
    expect(
      (await post("/api/v1/homework", tok.teacher, { subjectId: subj, semesterId: NIL_UUID, title: "x" })).status
    ).toBe(400);
  });

  it("denies cross-institution access to college homework", async () => {
    const instB = await createInstitution("HCB", "college");
    await createUser({ email: "b@hc.dev", password: PW, role: "admin", institutionId: instB });
    const bTok = await tokenFor("b@hc.dev", PW);
    expect((await get(`/api/v1/homework/${hwSem1}`, bTok)).status).toBe(404);
  });
});
