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
function pdfParser(
  res: NodeJS.ReadableStream,
  cb: (err: Error | null, body: Buffer) => void
): void {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

describe("fee receipts & ID cards (PDFs)", () => {
  let instA: string;
  let sectionA: string;
  let st1: string;
  let st2: string;
  let pay1: string; // st1's payment
  let pay2: string; // st2's payment
  const id: Record<string, string> = {};
  const tok: Record<string, string> = {};

  const get = (path: string, token: string) =>
    request(app).get(path).set("Authorization", `Bearer ${token}`);
  const getPdf = (path: string, token: string) =>
    get(path, token).buffer(true).parse(pdfParser);

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("PA");
    id.admin = (await createUser({ email: "admin@p.dev", password: PW, role: "admin", institutionId: instA })).id;
    id.teacher = (await createUser({ email: "teacher@p.dev", password: PW, role: "teacher", institutionId: instA })).id;
    await createUser({ email: "accountant@p.dev", password: PW, role: "accountant", institutionId: instA });

    const classId = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'Grade 1', 1) RETURNING id`,
      [instA]
    );
    sectionA = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1, $2, 'A') RETURNING id`,
      [instA, classId]
    );
    st1 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id) VALUES ($1, 'P1', 'Ava', 'One', $2) RETURNING id`,
      [instA, sectionA]
    );
    st2 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id) VALUES ($1, 'P2', 'Ben', 'Two', $2) RETURNING id`,
      [instA, sectionA]
    );
    const su1 = await createUser({ email: "su1@p.dev", password: PW, role: "student", institutionId: instA });
    await query(`UPDATE students SET user_id = $1 WHERE id = $2`, [su1.id, st1]);
    const su2 = await createUser({ email: "su2@p.dev", password: PW, role: "student", institutionId: instA });
    await query(`UPDATE students SET user_id = $1 WHERE id = $2`, [su2.id, st2]);
    const pu1 = await createUser({ email: "pu1@p.dev", password: PW, role: "parent", institutionId: instA });
    await query(
      `INSERT INTO guardians (institution_id, user_id, student_id, relationship) VALUES ($1, $2, $3, 'mother')`,
      [instA, pu1.id, st1]
    );

    const inv1 = await insertId(
      `INSERT INTO invoices (institution_id, invoice_no, student_id, description, amount_due, amount_paid, due_date)
       VALUES ($1, 'INV-1', $2, 'Tuition', 1000, 400, '2026-12-31') RETURNING id`,
      [instA, st1]
    );
    pay1 = await insertId(
      `INSERT INTO payments (institution_id, invoice_id, amount, method, received_by) VALUES ($1, $2, 400, 'cash', $3) RETURNING id`,
      [instA, inv1, id.admin]
    );
    const inv2 = await insertId(
      `INSERT INTO invoices (institution_id, invoice_no, student_id, description, amount_due, amount_paid, due_date)
       VALUES ($1, 'INV-2', $2, 'Tuition', 1000, 500, '2026-12-31') RETURNING id`,
      [instA, st2]
    );
    pay2 = await insertId(
      `INSERT INTO payments (institution_id, invoice_id, amount, method, received_by) VALUES ($1, $2, 500, 'card', $3) RETURNING id`,
      [instA, inv2, id.admin]
    );

    for (const e of ["admin", "teacher", "accountant"]) tok[e] = await tokenFor(`${e}@p.dev`, PW);
    tok.su1 = await tokenFor("su1@p.dev", PW);
    tok.su2 = await tokenFor("su2@p.dev", PW);
    tok.pu1 = await tokenFor("pu1@p.dev", PW);
  });

  it("generates a fee receipt PDF (no logo configured → graceful)", async () => {
    const res = await getPdf(`/api/v1/fee-receipts/${pay1}/download`, tok.admin);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(res.body.length).toBeGreaterThan(800);
  });

  it("scopes receipts to the owner (student/parent)", async () => {
    expect((await get(`/api/v1/fee-receipts/${pay1}/download`, tok.su1)).status).toBe(200); // own
    expect((await get(`/api/v1/fee-receipts/${pay2}/download`, tok.su1)).status).toBe(403); // other student
    expect((await get(`/api/v1/fee-receipts/${pay1}/download`, tok.pu1)).status).toBe(200); // linked child
    expect((await get(`/api/v1/fee-receipts/${pay2}/download`, tok.pu1)).status).toBe(403); // unrelated child
  });

  it("denies cross-institution receipt access", async () => {
    const instB = await createInstitution("PB");
    const bAdmin = await createUser({ email: "badmin@p.dev", password: PW, role: "admin", institutionId: instB });
    const bToken = await tokenFor("badmin@p.dev", PW);
    expect((await get(`/api/v1/fee-receipts/${pay1}/download`, bToken)).status).toBe(404);
    void bAdmin;
  });

  it("generates a student ID card PDF (graceful when no photo)", async () => {
    const res = await getPdf(`/api/v1/id-cards/student/${st1}/download`, tok.admin);
    expect(res.status).toBe(200);
    expect(res.body.subarray(0, 5).toString()).toBe("%PDF-");
    // owner-scoping
    expect((await get(`/api/v1/id-cards/student/${st1}/download`, tok.su1)).status).toBe(200);
    expect((await get(`/api/v1/id-cards/student/${st2}/download`, tok.su1)).status).toBe(403);
    expect((await get(`/api/v1/id-cards/student/${st1}/download`, tok.pu1)).status).toBe(200);
  });

  it("generates a staff ID card PDF (own / admin-any)", async () => {
    const res = await getPdf(`/api/v1/id-cards/staff/${id.teacher}/download`, tok.admin);
    expect(res.status).toBe(200);
    expect(res.body.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await get(`/api/v1/id-cards/staff/${id.teacher}/download`, tok.teacher)).status).toBe(200); // own
    expect((await get(`/api/v1/id-cards/staff/${id.admin}/download`, tok.teacher)).status).toBe(403); // other staff
    expect((await get(`/api/v1/id-cards/staff/${id.teacher}/download`, tok.su1)).status).toBe(403); // student
  });

  it("exports a section's ID cards in bulk (staff only)", async () => {
    const res = await getPdf(`/api/v1/id-cards/section/${sectionA}/bulk`, tok.teacher);
    expect(res.status).toBe(200);
    expect(res.body.subarray(0, 5).toString()).toBe("%PDF-");
    // student lacks id_cards:generate
    expect((await get(`/api/v1/id-cards/section/${sectionA}/bulk`, tok.su1)).status).toBe(403);
  });

  it("handles invalid payment/student/staff", async () => {
    const fake = "00000000-0000-0000-0000-000000000000";
    expect((await get(`/api/v1/fee-receipts/${fake}/download`, tok.admin)).status).toBe(404);
    expect((await get(`/api/v1/id-cards/student/${fake}/download`, tok.admin)).status).toBe(404);
    expect((await get(`/api/v1/id-cards/staff/${fake}/download`, tok.admin)).status).toBe(404);
  });
});
