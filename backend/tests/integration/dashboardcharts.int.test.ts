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

describe("dashboard charts (/dashboard/charts)", () => {
  let instA: string;
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("DC");
    await createUser({ email: "admin@dc.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "super@dc.dev", password: PW, role: "super_admin", institutionId: null });

    const classId = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'Grade 1', 1) RETURNING id`,
      [instA]
    );
    const sectionId = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1, $2, 'A') RETURNING id`,
      [instA, classId]
    );
    const studentId = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id, gender, status)
       VALUES ($1, 'DC-1', 'Ann', 'B', $2, 'female', 'active') RETURNING id`,
      [instA, sectionId]
    );
    await query(
      `INSERT INTO attendance_records (institution_id, student_id, date, status) VALUES ($1, $2, CURRENT_DATE, 'present')`,
      [instA, studentId]
    );
    const invoiceId = await insertId(
      `INSERT INTO invoices (institution_id, invoice_no, student_id, description, amount_due, due_date)
       VALUES ($1, 'INV-DC-1', $2, 'Term', 1000, '2026-12-31') RETURNING id`,
      [instA, studentId]
    );
    await query(
      `INSERT INTO payments (institution_id, invoice_id, amount, method) VALUES ($1, $2, 500, 'cash')`,
      [instA, invoiceId]
    );

    tok.admin = await tokenFor("admin@dc.dev", PW);
    tok.super = await tokenFor("super@dc.dev", PW);
  });

  it("requires auth + a tenant", async () => {
    expect((await request(app).get("/api/v1/dashboard/charts")).status).toBe(401);
    expect((await request(app).get("/api/v1/dashboard/charts").set(auth(tok.super))).status).toBe(403);
  });

  it("returns chart datasets reflecting the tenant's data", async () => {
    const res = await request(app).get("/api/v1/dashboard/charts").set(auth(tok.admin));
    expect(res.status).toBe(200);

    expect(Array.isArray(res.body.enrollmentByClass)).toBe(true);
    const grade1 = res.body.enrollmentByClass.find((r: { label: string }) => r.label === "Grade 1");
    expect(grade1?.value).toBe(1);

    expect(Array.isArray(res.body.attendanceTrend)).toBe(true);
    const today = res.body.attendanceTrend.at(-1);
    expect(today.present).toBe(1);
    expect(today.rate).toBe(1);

    const month = res.body.feeCollectionByMonth.at(-1);
    expect(Number(month.amount)).toBe(500);

    const female = res.body.studentsByGender.find((r: { label: string }) => r.label === "female");
    expect(female?.value).toBe(1);
  });
});
