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

describe("polls / surveys (/polls, /portal)", () => {
  let instA: string;
  let classId: string;
  let classB2: string;
  let s1: string;
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("PL");
    await createInstitution("PL2");
    await createUser({ email: "admin@pl.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "super@pl.dev", password: PW, role: "super_admin", institutionId: null });

    classId = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'Grade 9', 9) RETURNING id`,
      [instA]
    );
    classB2 = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'Grade 10', 10) RETURNING id`,
      [instA]
    );
    const sectionA = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1, $2, 'A') RETURNING id`,
      [instA, classId]
    );
    s1 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id) VALUES ($1, 'PL-1', 'Tara', 'S', $2) RETURNING id`,
      [instA, sectionA]
    );
    const studentUser = await createUser({
      email: "stud@pl.dev", password: PW, role: "student", institutionId: instA,
    });
    await query(`UPDATE students SET user_id = $1 WHERE id = $2`, [studentUser.id, s1]);

    tok.admin = await tokenFor("admin@pl.dev", PW);
    tok.super = await tokenFor("super@pl.dev", PW);
    tok.student = await tokenFor("stud@pl.dev", PW);
  });

  it("requires auth + tenant + staff role", async () => {
    expect((await request(app).get("/api/v1/polls")).status).toBe(401);
    expect((await request(app).get("/api/v1/polls").set(auth(tok.super))).status).toBe(403);
    expect((await request(app).get("/api/v1/polls").set(auth(tok.student))).status).toBe(403);
  });

  async function buildPoll(targetClass = classId) {
    const res = await request(app)
      .post("/api/v1/polls")
      .set(auth(tok.admin))
      .send({ question: "Favourite sport?", classId: targetClass, options: ["Cricket", "Football", "Hockey"] });
    expect(res.status).toBe(201);
    expect(res.body.options).toHaveLength(3);
    return { pollId: res.body.id as string, optionId: res.body.options[0].id as string };
  }

  it("creates a poll, a student votes, and results are revealed after voting", async () => {
    const { pollId, optionId } = await buildPoll();

    // Unpublished → not visible to the student.
    let list = await request(app).get(`/api/v1/portal/students/${s1}/polls`).set(auth(tok.student));
    expect(list.body).toHaveLength(0);

    await request(app).patch(`/api/v1/polls/${pollId}`).set(auth(tok.admin)).send({ isPublished: true });

    list = await request(app).get(`/api/v1/portal/students/${s1}/polls`).set(auth(tok.student));
    expect(list.body).toHaveLength(1);
    expect(list.body[0].voted).toBe(false);

    // Before voting, counts are hidden.
    const before = await request(app)
      .get(`/api/v1/portal/students/${s1}/polls/${pollId}`)
      .set(auth(tok.student));
    expect(before.body.voted).toBe(false);
    expect(before.body.options[0].votes).toBeUndefined();

    // Vote.
    const voted = await request(app)
      .post(`/api/v1/portal/students/${s1}/polls/${pollId}/vote`)
      .set(auth(tok.student))
      .send({ optionId });
    expect(voted.status).toBe(201);

    // Second vote rejected.
    expect(
      (await request(app).post(`/api/v1/portal/students/${s1}/polls/${pollId}/vote`).set(auth(tok.student)).send({ optionId })).status
    ).toBe(409);

    // After voting, results are revealed.
    const after = await request(app)
      .get(`/api/v1/portal/students/${s1}/polls/${pollId}`)
      .set(auth(tok.student));
    expect(after.body.voted).toBe(true);
    expect(after.body.myOptionId).toBe(optionId);
    const chosen = (after.body.options as { id: string; votes: number }[]).find((o) => o.id === optionId);
    expect(chosen?.votes).toBe(1);

    // Staff results reflect the vote.
    const staff = await request(app).get(`/api/v1/polls/${pollId}`).set(auth(tok.admin));
    expect(staff.body.totalVotes).toBe(1);
  });

  it("rejects an invalid option and a poll needs >= 2 options", async () => {
    const { pollId } = await buildPoll();
    await request(app).patch(`/api/v1/polls/${pollId}`).set(auth(tok.admin)).send({ isPublished: true });
    expect(
      (await request(app).post(`/api/v1/portal/students/${s1}/polls/${pollId}/vote`).set(auth(tok.student))
        .send({ optionId: "00000000-0000-0000-0000-000000000000" })).status
    ).toBe(400);
    expect(
      (await request(app).post("/api/v1/polls").set(auth(tok.admin)).send({ question: "x", options: ["only one"] })).status
    ).toBe(400);
  });

  it("a student cannot see a poll for another class", async () => {
    const { pollId } = await buildPoll(classB2);
    await request(app).patch(`/api/v1/polls/${pollId}`).set(auth(tok.admin)).send({ isPublished: true });
    const list = await request(app).get(`/api/v1/portal/students/${s1}/polls`).set(auth(tok.student));
    expect(list.body).toHaveLength(0);
    expect(
      (await request(app).get(`/api/v1/portal/students/${s1}/polls/${pollId}`).set(auth(tok.student))).status
    ).toBe(404);
  });
});
