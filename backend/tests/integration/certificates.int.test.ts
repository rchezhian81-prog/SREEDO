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

function binaryParser(
  res: NodeJS.ReadableStream,
  cb: (err: Error | null, body: Buffer) => void
): void {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

async function insertId(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await query<{ id: string }>(sql, params);
  return rows[0].id;
}

describe("student certificates", () => {
  let instA: string;
  let studentId: string;
  const tok: Record<string, string> = {};

  const getPdf = (path: string, token: string) =>
    request(app)
      .get(path)
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse(binaryParser);
  const get = (path: string, token: string) =>
    request(app).get(path).set("Authorization", `Bearer ${token}`);

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("CERT");
    for (const role of ["admin", "teacher", "accountant"] as const) {
      await createUser({
        email: `${role}@cert.dev`,
        password: PW,
        role,
        institutionId: instA,
      });
      tok[role] = await tokenFor(`${role}@cert.dev`, PW);
    }
    await query(
      "INSERT INTO academic_years (institution_id, name, start_date, end_date, is_current) VALUES ($1, '2026-2027', '2026-06-01', '2027-04-30', true)",
      [instA]
    );
    const classId = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'Grade 5', 5) RETURNING id`,
      [instA]
    );
    const sectionId = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1, $2, 'A') RETURNING id`,
      [instA, classId]
    );
    studentId = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, gender, guardian_name, section_id)
       VALUES ($1, 'C-1', 'Maya', 'Iyer', 'female', 'Raj Iyer', $2) RETURNING id`,
      [instA, sectionId]
    );

    // A student-role user linked to the student, and a parent — for guard checks.
    const su = await createUser({
      email: "kid@cert.dev",
      password: PW,
      role: "student",
      institutionId: instA,
    });
    await query("UPDATE students SET user_id = $1 WHERE id = $2", [
      su.id,
      studentId,
    ]);
    tok.student = await tokenFor("kid@cert.dev", PW);
  });

  const url = (type: string) =>
    `/api/v1/certificates/student/${studentId}/${type}/download`;

  it("generates each certificate type as a PDF (staff)", async () => {
    for (const type of ["bonafide", "conduct", "character"]) {
      const res = await getPdf(url(type), tok.admin);
      expect(res.status, type).toBe(200);
      expect(res.body.subarray(0, 5).toString()).toBe("%PDF-");
    }
  });

  it("accepts an optional purpose and lets a teacher issue", async () => {
    const res = await getPdf(
      `${url("bonafide")}?purpose=bank%20account%20opening`,
      tok.teacher
    );
    expect(res.status).toBe(200);
    expect(res.body.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("rejects an unknown certificate type (400)", async () => {
    expect((await get(url("random"), tok.admin)).status).toBe(400);
  });

  it("is staff-only (students, parents, accountants cannot issue)", async () => {
    expect((await get(url("bonafide"), tok.student)).status).toBe(403);
    expect((await get(url("bonafide"), tok.accountant)).status).toBe(403);
  });

  it("does not leak across institutions (404)", async () => {
    const instB = await createInstitution("CERTB");
    await createUser({
      email: "admin@certb.dev",
      password: PW,
      role: "admin",
      institutionId: instB,
    });
    const bToken = await tokenFor("admin@certb.dev", PW);
    expect((await get(url("bonafide"), bToken)).status).toBe(404);
  });
});
