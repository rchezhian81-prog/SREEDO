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

describe("online quizzes (/quizzes, /portal)", () => {
  let instA: string;
  let instB: string;
  let classId: string;
  let classB2: string;
  let subjectId: string;
  let s1: string;
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("QZ");
    instB = await createInstitution("QZ2");

    await createUser({ email: "admin@qz.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "teacher@qz.dev", password: PW, role: "teacher", institutionId: instA });
    await createUser({ email: "admin@qz2.dev", password: PW, role: "admin", institutionId: instB });
    await createUser({ email: "super@qz.dev", password: PW, role: "super_admin", institutionId: null });

    classId = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'Grade 7', 7) RETURNING id`,
      [instA]
    );
    classB2 = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'Grade 8', 8) RETURNING id`,
      [instA]
    );
    const sectionA = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1, $2, 'A') RETURNING id`,
      [instA, classId]
    );
    subjectId = await insertId(
      `INSERT INTO subjects (institution_id, name, code) VALUES ($1, 'Maths', 'MAT-QZ') RETURNING id`,
      [instA]
    );
    s1 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id) VALUES ($1, 'QZ-1', 'Nila', 'Raj', $2) RETURNING id`,
      [instA, sectionA]
    );
    const studentUser = await createUser({
      email: "stud@qz.dev", password: PW, role: "student", institutionId: instA,
    });
    await query(`UPDATE students SET user_id = $1 WHERE id = $2`, [studentUser.id, s1]);

    tok.admin = await tokenFor("admin@qz.dev", PW);
    tok.teacher = await tokenFor("teacher@qz.dev", PW);
    tok.adminB = await tokenFor("admin@qz2.dev", PW);
    tok.super = await tokenFor("super@qz.dev", PW);
    tok.student = await tokenFor("stud@qz.dev", PW);
  });

  it("requires auth + tenant + staff role", async () => {
    expect((await request(app).get("/api/v1/quizzes")).status).toBe(401);
    expect((await request(app).get("/api/v1/quizzes").set(auth(tok.super))).status).toBe(403);
    expect((await request(app).get("/api/v1/quizzes").set(auth(tok.student))).status).toBe(403);
  });

  /** Creates a 2-question quiz for `classId` and returns {quizId, q1, q2}. */
  async function buildQuiz(targetClass = classId) {
    const quiz = await request(app)
      .post("/api/v1/quizzes")
      .set(auth(tok.teacher))
      .send({ title: "Algebra basics", subjectId, classId: targetClass });
    expect(quiz.status).toBe(201);
    const quizId = quiz.body.id as string;

    await request(app).post(`/api/v1/quizzes/${quizId}/questions`).set(auth(tok.teacher))
      .send({ questionText: "2 + 2 = ?", optionA: "4", optionB: "5", correctOption: "A", marks: 2 });
    const afterTwo = await request(app).post(`/api/v1/quizzes/${quizId}/questions`).set(auth(tok.teacher))
      .send({ questionText: "3 x 3 = ?", optionA: "6", optionB: "9", correctOption: "B", marks: 3 });
    expect(afterTwo.status).toBe(201);

    const q1 = afterTwo.body.questions.find((q: { questionText: string }) => q.questionText === "2 + 2 = ?").id;
    const q2 = afterTwo.body.questions.find((q: { questionText: string }) => q.questionText === "3 x 3 = ?").id;
    return { quizId, q1, q2 };
  }

  it("teacher authors a quiz with questions and totals", async () => {
    const { quizId } = await buildQuiz();
    const got = await request(app).get(`/api/v1/quizzes/${quizId}`).set(auth(tok.admin));
    expect(got.body.questionCount).toBe(2);
    expect(got.body.totalMarks).toBe(5);
    expect(got.body.questions).toHaveLength(2);
    // Staff view exposes the correct option.
    expect(got.body.questions[0].correctOption).toBeDefined();
  });

  it("a student only sees published quizzes for their class, and is auto-graded", async () => {
    const { quizId, q1, q2 } = await buildQuiz();

    // Unpublished → not visible to the student yet.
    let list = await request(app).get(`/api/v1/portal/students/${s1}/quizzes`).set(auth(tok.student));
    expect(list.body).toHaveLength(0);

    // Publish it.
    await request(app).patch(`/api/v1/quizzes/${quizId}`).set(auth(tok.teacher)).send({ isPublished: true });

    list = await request(app).get(`/api/v1/portal/students/${s1}/quizzes`).set(auth(tok.student));
    expect(list.body).toHaveLength(1);
    expect(list.body[0].attempted).toBe(false);

    // Taking view hides the correct answers.
    const taking = await request(app)
      .get(`/api/v1/portal/students/${s1}/quizzes/${quizId}`)
      .set(auth(tok.student));
    expect(taking.body.attempted).toBe(false);
    expect(taking.body.questions[0].correctOption).toBeUndefined();

    // Submit: q1 correct (+2), q2 wrong (+0) → 2 / 5.
    const submit = await request(app)
      .post(`/api/v1/portal/students/${s1}/quizzes/${quizId}/attempt`)
      .set(auth(tok.student))
      .send({ answers: { [q1]: "A", [q2]: "A" } });
    expect(submit.status).toBe(201);
    expect(submit.body.score).toBe(2);
    expect(submit.body.total).toBe(5);

    // No second attempt.
    const again = await request(app)
      .post(`/api/v1/portal/students/${s1}/quizzes/${quizId}/attempt`)
      .set(auth(tok.student))
      .send({ answers: { [q1]: "A", [q2]: "B" } });
    expect(again.status).toBe(409);

    // After attempting, the review view reveals answers + result.
    const review = await request(app)
      .get(`/api/v1/portal/students/${s1}/quizzes/${quizId}`)
      .set(auth(tok.student));
    expect(review.body.attempted).toBe(true);
    expect(review.body.result.score).toBe(2);
    expect(review.body.questions[0].correctOption).toBe("A");
  });

  it("a student cannot see a quiz for another class", async () => {
    const { quizId } = await buildQuiz(classB2);
    await request(app).patch(`/api/v1/quizzes/${quizId}`).set(auth(tok.teacher)).send({ isPublished: true });

    const list = await request(app).get(`/api/v1/portal/students/${s1}/quizzes`).set(auth(tok.student));
    expect(list.body).toHaveLength(0);
    expect(
      (await request(app).get(`/api/v1/portal/students/${s1}/quizzes/${quizId}`).set(auth(tok.student))).status
    ).toBe(404);
  });

  it("validates questions and isolates tenants", async () => {
    const { quizId } = await buildQuiz();
    // correctOption C but no optionC → 400.
    expect(
      (await request(app).post(`/api/v1/quizzes/${quizId}/questions`).set(auth(tok.teacher))
        .send({ questionText: "x", optionA: "a", optionB: "b", correctOption: "C" })).status
    ).toBe(400);
    // Admin B (other tenant) cannot read the quiz.
    expect(
      (await request(app).get(`/api/v1/quizzes/${quizId}`).set(auth(tok.adminB))).status
    ).toBe(404);
  });
});
