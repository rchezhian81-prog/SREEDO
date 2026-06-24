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

describe("timetable auto-generation (/timetable-gen)", () => {
  let instA: string;
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function teacher(inst: string, code: string) {
    return insertId(
      `INSERT INTO teachers (institution_id, employee_no, first_name, last_name) VALUES ($1, $2, 'T', $2) RETURNING id`,
      [inst, code]
    );
  }
  async function subject(inst: string, code: string) {
    return insertId(
      `INSERT INTO subjects (institution_id, name, code) VALUES ($1, $2, $2) RETURNING id`,
      [inst, code]
    );
  }

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("TG");
    await createUser({ email: "admin@tg.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "teacher@tg.dev", password: PW, role: "teacher", institutionId: instA });
    await createUser({ email: "super@tg.dev", password: PW, role: "super_admin", institutionId: null });
    tok.admin = await tokenFor("admin@tg.dev", PW);
    tok.teacher = await tokenFor("teacher@tg.dev", PW);
    tok.super = await tokenFor("super@tg.dev", PW);
  });

  it("requires auth + tenant + admin role", async () => {
    expect((await request(app).post("/api/v1/timetable-gen/generate")).status).toBe(401);
    expect((await request(app).post("/api/v1/timetable-gen/generate").set(auth(tok.super))).status).toBe(403);
    expect((await request(app).post("/api/v1/timetable-gen/generate").set(auth(tok.teacher))).status).toBe(403);
  });

  it("400s when there are no periods or no class subjects", async () => {
    // No periods yet.
    expect(
      (await request(app).post("/api/v1/timetable-gen/generate").set(auth(tok.admin)).send({})).status
    ).toBe(400);

    // Periods but no class subjects.
    await query(
      `INSERT INTO periods (institution_id, name, start_time, end_time, sort_order) VALUES ($1, 'P1', '09:00', '09:45', 1)`,
      [instA]
    );
    expect(
      (await request(app).post("/api/v1/timetable-gen/generate").set(auth(tok.admin)).send({})).status
    ).toBe(400);
  });

  it("generates a clash-free timetable and regenerating replaces it", async () => {
    const classId = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'G1', 1) RETURNING id`,
      [instA]
    );
    const secA = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1, $2, 'A') RETURNING id`,
      [instA, classId]
    );
    const secB = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1, $2, 'B') RETURNING id`,
      [instA, classId]
    );
    for (const name of ["P1", "P2"]) {
      await query(
        `INSERT INTO periods (institution_id, name, start_time, end_time, sort_order) VALUES ($1, $2, '09:00', '09:45', $3)`,
        [instA, name, name === "P1" ? 1 : 2]
      );
    }
    const t1 = await teacher(instA, "T1");
    const t2 = await teacher(instA, "T2");
    const subX = await subject(instA, "X");
    const subY = await subject(instA, "Y");
    const subZ = await subject(instA, "Z");
    // secA: X by T1, Z by T2;  secB: Y by T1 (T1 shared -> forces clash avoidance)
    await query(`INSERT INTO class_subjects (institution_id, section_id, subject_id, teacher_id) VALUES ($1,$2,$3,$4),($1,$2,$5,$6)`, [instA, secA, subX, t1, subZ, t2]);
    await query(`INSERT INTO class_subjects (institution_id, section_id, subject_id, teacher_id) VALUES ($1,$2,$3,$4)`, [instA, secB, subY, t1]);

    const gen = await request(app)
      .post("/api/v1/timetable-gen/generate")
      .set(auth(tok.admin))
      .send({ days: [1] });
    expect(gen.status).toBe(200);
    expect(gen.body.totalEntries).toBeGreaterThan(0);

    // No teacher is ever double-booked in the same day+period.
    const clashes = await query<{ count: string }>(
      `SELECT count(*) FROM (
         SELECT day_of_week, period_id, teacher_id FROM timetable_entries
         WHERE institution_id = $1 AND teacher_id IS NOT NULL
         GROUP BY day_of_week, period_id, teacher_id HAVING count(*) > 1
       ) x`,
      [instA]
    );
    expect(Number(clashes.rows[0].count)).toBe(0);

    const firstCount = await query<{ count: string }>(
      `SELECT count(*) FROM timetable_entries WHERE institution_id = $1`,
      [instA]
    );

    // Regenerate — entries are replaced, not duplicated.
    const gen2 = await request(app)
      .post("/api/v1/timetable-gen/generate")
      .set(auth(tok.admin))
      .send({ days: [1] });
    expect(gen2.status).toBe(200);
    const secondCount = await query<{ count: string }>(
      `SELECT count(*) FROM timetable_entries WHERE institution_id = $1`,
      [instA]
    );
    expect(secondCount.rows[0].count).toBe(firstCount.rows[0].count);
  });
});
