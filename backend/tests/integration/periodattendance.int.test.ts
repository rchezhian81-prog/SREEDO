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

describe("period attendance (/period-attendance)", () => {
  let instA: string;
  let sectionId: string;
  let periodId: string;
  let s1: string;
  let s2: string;
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("PA");
    await createInstitution("PA2");
    await createUser({ email: "admin@pa.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "teacher@pa.dev", password: PW, role: "teacher", institutionId: instA });
    await createUser({ email: "stud@pa.dev", password: PW, role: "student", institutionId: instA });
    await createUser({ email: "super@pa.dev", password: PW, role: "super_admin", institutionId: null });

    const classId = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'Grade 9', 9) RETURNING id`,
      [instA]
    );
    sectionId = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1, $2, 'A') RETURNING id`,
      [instA, classId]
    );
    periodId = await insertId(
      `INSERT INTO periods (institution_id, name, start_time, end_time, sort_order) VALUES ($1, 'P1', '09:00', '09:45', 1) RETURNING id`,
      [instA]
    );
    s1 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id, status) VALUES ($1, 'PA-1', 'Asha', 'R', $2, 'active') RETURNING id`,
      [instA, sectionId]
    );
    s2 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id, status) VALUES ($1, 'PA-2', 'Bala', 'K', $2, 'active') RETURNING id`,
      [instA, sectionId]
    );

    tok.admin = await tokenFor("admin@pa.dev", PW);
    tok.teacher = await tokenFor("teacher@pa.dev", PW);
    tok.student = await tokenFor("stud@pa.dev", PW);
    tok.super = await tokenFor("super@pa.dev", PW);
  });

  const rosterUrl = (d = "2026-06-24") =>
    `/api/v1/period-attendance/roster?sectionId=${sectionId}&date=${d}&periodId=${periodId}`;

  it("requires auth + tenant + staff role", async () => {
    expect((await request(app).get(rosterUrl())).status).toBe(401);
    expect((await request(app).get(rosterUrl()).set(auth(tok.super))).status).toBe(403);
    expect((await request(app).get(rosterUrl()).set(auth(tok.student))).status).toBe(403);
  });

  it("loads a roster, marks the period, and upserts on re-mark", async () => {
    const roster = await request(app).get(rosterUrl()).set(auth(tok.teacher));
    expect(roster.status).toBe(200);
    expect(roster.body.records).toHaveLength(2);
    expect(roster.body.records.every((r: { status: string | null }) => r.status === null)).toBe(true);

    const marked = await request(app)
      .post("/api/v1/period-attendance")
      .set(auth(tok.teacher))
      .send({
        date: "2026-06-24",
        periodId,
        entries: [
          { studentId: s1, status: "present" },
          { studentId: s2, status: "absent" },
        ],
      });
    expect(marked.status).toBe(200);
    expect(marked.body.marked).toBe(2);

    const after = await request(app).get(rosterUrl()).set(auth(tok.teacher));
    const byId = Object.fromEntries(
      after.body.records.map((r: { studentId: string; status: string }) => [r.studentId, r.status])
    );
    expect(byId[s1]).toBe("present");
    expect(byId[s2]).toBe("absent");

    // Re-mark s1 → upsert, not duplicate.
    await request(app)
      .post("/api/v1/period-attendance")
      .set(auth(tok.teacher))
      .send({ date: "2026-06-24", periodId, entries: [{ studentId: s1, status: "late" }] });
    const after2 = await request(app).get(rosterUrl()).set(auth(tok.teacher));
    const s1row = after2.body.records.filter((r: { studentId: string }) => r.studentId === s1);
    expect(s1row).toHaveLength(1);
    expect(s1row[0].status).toBe("late");
  });

  it("rejects a student from another tenant in the entries", async () => {
    const otherInst = await insertId(
      `INSERT INTO institutions (name, code, type) VALUES ('Other', 'PAX', 'school') RETURNING id`,
      []
    );
    const foreign = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name) VALUES ($1, 'X-1', 'Foreign', 'Kid') RETURNING id`,
      [otherInst]
    );
    const res = await request(app)
      .post("/api/v1/period-attendance")
      .set(auth(tok.admin))
      .send({ date: "2026-06-24", periodId, entries: [{ studentId: foreign, status: "present" }] });
    expect(res.status).toBe(400);
  });

  it("isolates tenants on the roster", async () => {
    await createUser({ email: "admin@pa2.dev", password: PW, role: "admin", institutionId: (await query<{ id: string }>("SELECT id FROM institutions WHERE code='PA2'", [])).rows[0].id });
    const tokB = await tokenFor("admin@pa2.dev", PW);
    expect((await request(app).get(rosterUrl()).set(auth(tokB))).status).toBe(404);
  });
});
