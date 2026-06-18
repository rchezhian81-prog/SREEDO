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

/** Buffers a binary (PDF) response so we can assert on the bytes. */
function pdfParser(
  res: NodeJS.ReadableStream,
  cb: (err: Error | null, body: Buffer) => void
): void {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

describe("report cards & mark sheets", () => {
  let instA: string;
  let examA: string;
  let sectionA: string;
  let st1: string;
  let st2: string;
  let stNoResults: string;
  let sB: string;
  const tok: Record<string, string> = {};

  const get = (path: string, token: string) =>
    request(app).get(path).set("Authorization", `Bearer ${token}`);

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("RA");
    for (const role of ["admin", "teacher", "accountant", "student", "parent"] as const) {
      await createUser({ email: `${role}@r.dev`, password: PW, role, institutionId: instA });
    }

    const classId = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'Grade 5', 5) RETURNING id`,
      [instA]
    );
    sectionA = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1, $2, 'A') RETURNING id`,
      [instA, classId]
    );
    st1 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id) VALUES ($1, 'R1', 'Ava', 'One', $2) RETURNING id`,
      [instA, sectionA]
    );
    st2 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id) VALUES ($1, 'R2', 'Ben', 'Two', $2) RETURNING id`,
      [instA, sectionA]
    );
    stNoResults = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id) VALUES ($1, 'R3', 'Cyn', 'Three', $2) RETURNING id`,
      [instA, sectionA]
    );

    // Link student login -> st1; parent -> st1.
    const studentUser = await query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'student@r.dev'`
    );
    await query(`UPDATE students SET user_id = $1 WHERE id = $2`, [
      studentUser.rows[0].id,
      st1,
    ]);
    const parentUser = await query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'parent@r.dev'`
    );
    await query(
      `INSERT INTO guardians (institution_id, user_id, student_id, relationship) VALUES ($1, $2, $3, 'mother')`,
      [instA, parentUser.rows[0].id, st1]
    );

    const math = await insertId(
      `INSERT INTO subjects (institution_id, name, code) VALUES ($1, 'Math', 'MATH') RETURNING id`,
      [instA]
    );
    const eng = await insertId(
      `INSERT INTO subjects (institution_id, name, code) VALUES ($1, 'English', 'ENG') RETURNING id`,
      [instA]
    );
    examA = await insertId(
      `INSERT INTO exams (institution_id, name) VALUES ($1, 'Term 1') RETURNING id`,
      [instA]
    );
    // st1 passes (80%, 60%), st2 fails (30% in Math).
    for (const [sid, subj, marks] of [
      [st1, math, 80],
      [st1, eng, 60],
      [st2, math, 30],
      [st2, eng, 40],
    ] as Array<[string, string, number]>) {
      await query(
        `INSERT INTO exam_results (institution_id, exam_id, student_id, subject_id, marks_obtained, max_marks)
         VALUES ($1, $2, $3, $4, $5, 100)`,
        [instA, examA, sid, subj, marks]
      );
    }

    // Grade scale for instA.
    for (const [grade, lo, hi] of [
      ["A+", 90, 100],
      ["A", 80, 90],
      ["B", 70, 80],
      ["C", 60, 70],
      ["E", 35, 50],
      ["F", 0, 35],
    ] as Array<[string, number, number]>) {
      await query(
        `INSERT INTO grade_bands (institution_id, grade, min_percent, max_percent) VALUES ($1, $2, $3, $4)`,
        [instA, grade, lo, hi]
      );
    }

    // Cross-institution student.
    const instB = await createInstitution("RB");
    const classB = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'GB', 1) RETURNING id`,
      [instB]
    );
    const secB = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1, $2, 'A') RETURNING id`,
      [instB, classB]
    );
    sB = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id) VALUES ($1, 'B1', 'Boo', 'Bee', $2) RETURNING id`,
      [instB, secB]
    );

    for (const role of ["admin", "teacher", "accountant", "student", "parent"]) {
      tok[role] = await tokenFor(`${role}@r.dev`, PW);
    }
  });

  it("generates a student report card PDF (CI confirms pdfkit works)", async () => {
    const res = await get(
      `/api/v1/reports/report-card?examId=${examA}&studentId=${st1}`,
      tok.admin
    )
      .buffer(true)
      .parse(pdfParser);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(res.body.length).toBeGreaterThan(800);
  });

  it("generates a class/section mark-sheet PDF", async () => {
    const res = await get(
      `/api/v1/reports/mark-sheet?examId=${examA}&sectionId=${sectionA}`,
      tok.admin
    )
      .buffer(true)
      .parse(pdfParser);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.body.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("enforces permissions", async () => {
    // accountant lacks report_cards:read
    expect(
      (await get(`/api/v1/reports/report-card?examId=${examA}&studentId=${st1}`, tok.accountant)).status
    ).toBe(403);
    // student lacks mark_sheets:export
    expect(
      (await get(`/api/v1/reports/mark-sheet?examId=${examA}&sectionId=${sectionA}`, tok.student)).status
    ).toBe(403);
    // accountant can read the grade scale (reports:read)
    expect((await get("/api/v1/reports/grade-bands", tok.accountant)).status).toBe(200);
    // teacher can manage bands (report_cards:generate); student cannot
    const teacherAdd = await request(app)
      .post("/api/v1/reports/grade-bands")
      .set("Authorization", `Bearer ${tok.teacher}`)
      .send({ grade: "Z", minPercent: 95, maxPercent: 100 });
    expect(teacherAdd.status).toBe(201);
    const studentAdd = await request(app)
      .post("/api/v1/reports/grade-bands")
      .set("Authorization", `Bearer ${tok.student}`)
      .send({ grade: "Y", minPercent: 95, maxPercent: 100 });
    expect(studentAdd.status).toBe(403);
  });

  it("lets a student download only their own report card", async () => {
    expect(
      (await get(`/api/v1/reports/report-card?examId=${examA}&studentId=${st1}`, tok.student)).status
    ).toBe(200);
    expect(
      (await get(`/api/v1/reports/report-card?examId=${examA}&studentId=${st2}`, tok.student)).status
    ).toBe(403);
  });

  it("lets a parent download only their linked child's report card", async () => {
    expect(
      (await get(`/api/v1/reports/report-card?examId=${examA}&studentId=${st1}`, tok.parent)).status
    ).toBe(200);
    expect(
      (await get(`/api/v1/reports/report-card?examId=${examA}&studentId=${st2}`, tok.parent)).status
    ).toBe(403);
  });

  it("denies cross-institution access (student not in tenant → 404)", async () => {
    const res = await get(
      `/api/v1/reports/report-card?examId=${examA}&studentId=${sB}`,
      tok.admin
    );
    expect(res.status).toBe(404);
  });

  it("handles invalid exam/student and missing results", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    // unknown exam
    expect(
      (await get(`/api/v1/reports/report-card?examId=${fakeId}&studentId=${st1}`, tok.admin)).status
    ).toBe(404);
    // unknown student
    expect(
      (await get(`/api/v1/reports/report-card?examId=${examA}&studentId=${fakeId}`, tok.admin)).status
    ).toBe(404);
    // valid student with no results
    expect(
      (await get(`/api/v1/reports/report-card?examId=${examA}&studentId=${stNoResults}`, tok.admin)).status
    ).toBe(404);
    // bad query (missing params) → 400
    expect((await get(`/api/v1/reports/report-card?examId=${examA}`, tok.admin)).status).toBe(400);
  });
});
