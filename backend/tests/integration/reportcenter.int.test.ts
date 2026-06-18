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
function binaryParser(
  res: NodeJS.ReadableStream,
  cb: (err: Error | null, body: Buffer) => void
): void {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

describe("reports center", () => {
  let instA: string;
  let examA: string;
  const tok: Record<string, string> = {};

  const get = (path: string, token: string) =>
    request(app).get(path).set("Authorization", `Bearer ${token}`);

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("RC");
    const teacher = await createUser({ email: "teacher@rc.dev", password: PW, role: "teacher", institutionId: instA });
    await createUser({ email: "admin@rc.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "accountant@rc.dev", password: PW, role: "accountant", institutionId: instA });
    await createUser({ email: "student@rc.dev", password: PW, role: "student", institutionId: instA });

    const classId = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'Grade 1', 1) RETURNING id`,
      [instA]
    );
    const sectionA = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1, $2, 'A') RETURNING id`,
      [instA, classId]
    );
    const st1 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id) VALUES ($1, 'RC-1', 'Ava', 'One', $2) RETURNING id`,
      [instA, sectionA]
    );
    const math = await insertId(
      `INSERT INTO subjects (institution_id, name, code) VALUES ($1, 'Math', 'MATH') RETURNING id`,
      [instA]
    );

    await query(`INSERT INTO attendance_records (institution_id, student_id, date, status) VALUES ($1,$2,'2026-03-01','present')`, [instA, st1]);
    await query(`INSERT INTO attendance_records (institution_id, student_id, date, status) VALUES ($1,$2,'2026-03-02','absent')`, [instA, st1]);

    const inv1 = await insertId(
      `INSERT INTO invoices (institution_id, invoice_no, student_id, description, amount_due, amount_paid, status, due_date)
       VALUES ($1, 'INV-RC1', $2, 'Tuition', 1000, 400, 'partially_paid', '2026-12-31') RETURNING id`,
      [instA, st1]
    );
    await query(`INSERT INTO payments (institution_id, invoice_id, amount, method) VALUES ($1,$2,400,'cash')`, [instA, inv1]);

    examA = await insertId(`INSERT INTO exams (institution_id, name) VALUES ($1, 'Term 1') RETURNING id`, [instA]);
    await query(
      `INSERT INTO exam_results (institution_id, exam_id, student_id, subject_id, marks_obtained, max_marks) VALUES ($1,$2,$3,$4,80,100)`,
      [instA, examA, st1, math]
    );

    const hw = await insertId(
      `INSERT INTO homework (institution_id, section_id, subject_id, title, due_date, created_by) VALUES ($1,$2,$3,'Worksheet','2026-04-01',$4) RETURNING id`,
      [instA, sectionA, math, teacher.id]
    );
    await query(`INSERT INTO homework_submissions (institution_id, homework_id, student_id, status) VALUES ($1,$2,$3,'submitted')`, [instA, hw, st1]);

    // Second institution (cross-tenant).
    const instB = await createInstitution("RD");
    await createUser({ email: "badmin@rc.dev", password: PW, role: "admin", institutionId: instB });
    const classB = await insertId(`INSERT INTO classes (institution_id, name, grade_level) VALUES ($1,'GB',1) RETURNING id`, [instB]);
    const secB = await insertId(`INSERT INTO sections (institution_id, class_id, name) VALUES ($1,$2,'A') RETURNING id`, [instB, classB]);
    await insertId(`INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id) VALUES ($1,'RD-1','Boo','Bee',$2) RETURNING id`, [instB, secB]);

    for (const e of ["admin", "teacher", "accountant", "student"]) tok[e] = await tokenFor(`${e}@rc.dev`, PW);
    tok.badmin = await tokenFor("badmin@rc.dev", PW);
  });

  it("lists available reports", async () => {
    const res = await get("/api/v1/report-center", tok.admin);
    expect(res.status).toBe(200);
    const keys = (res.body as Array<{ key: string }>).map((r) => r.key);
    expect(keys).toEqual(
      expect.arrayContaining(["students", "attendance", "fee_collection", "fee_dues", "exam_results", "homework"])
    );
  });

  it("runs the attendance report", async () => {
    const res = await get("/api/v1/report-center/attendance", tok.admin);
    expect(res.status).toBe(200);
    const ava = (res.body.rows as Array<Record<string, unknown>>).find((r) => r.admissionNo === "RC-1");
    expect(ava).toBeTruthy();
    expect(ava!.present).toBe(1);
    expect(ava!.absent).toBe(1);
  });

  it("runs the fee collection and dues reports", async () => {
    const collection = await get("/api/v1/report-center/fee_collection", tok.accountant);
    expect(collection.status).toBe(200);
    expect(collection.body.rows).toHaveLength(1);
    expect(Number(collection.body.rows[0].amount)).toBe(400);

    const dues = await get("/api/v1/report-center/fee_dues", tok.accountant);
    expect(dues.status).toBe(200);
    expect(dues.body.rows).toHaveLength(1);
    expect(Number(dues.body.rows[0].outstanding)).toBe(600);
  });

  it("runs the exam and homework reports", async () => {
    const exam = await get(`/api/v1/report-center/exam_results?examId=${examA}`, tok.teacher);
    expect(exam.status).toBe(200);
    expect(exam.body.rows).toHaveLength(1);
    expect(Number(exam.body.rows[0].marks)).toBe(80);

    const hw = await get("/api/v1/report-center/homework", tok.teacher);
    expect(hw.status).toBe(200);
    expect(hw.body.rows[0].submissions).toBe(1);
  });

  it("exports CSV and PDF", async () => {
    const csv = await get("/api/v1/report-center/students/export?format=csv", tok.admin);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/csv/);
    expect(csv.text).toContain("Admission No");
    expect(csv.text).toContain("RC-1");

    const pdf = await get("/api/v1/report-center/students/export?format=pdf", tok.admin)
      .buffer(true)
      .parse(binaryParser);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toMatch(/application\/pdf/);
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("enforces permission guards", async () => {
    expect((await get("/api/v1/report-center", tok.student)).status).toBe(403); // no center:read
    expect((await get("/api/v1/report-center/fee_collection", tok.teacher)).status).toBe(403); // teacher lacks fees:read
    expect((await get("/api/v1/report-center/attendance", tok.accountant)).status).toBe(403); // accountant lacks attendance:read
    expect((await get("/api/v1/report-center/fee_collection", tok.accountant)).status).toBe(200);
  });

  it("is tenant-scoped (no cross-institution leakage)", async () => {
    const a = await get("/api/v1/report-center/students", tok.admin);
    const aAdm = (a.body.rows as Array<Record<string, unknown>>).map((r) => r.admissionNo);
    expect(aAdm).toContain("RC-1");
    expect(aAdm).not.toContain("RD-1");

    const b = await get("/api/v1/report-center/students", tok.badmin);
    const bAdm = (b.body.rows as Array<Record<string, unknown>>).map((r) => r.admissionNo);
    expect(bAdm).toContain("RD-1");
    expect(bAdm).not.toContain("RC-1");
  });
});
