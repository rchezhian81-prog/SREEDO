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
const PDF = Buffer.from("%PDF-1.4\nhomework\n%%EOF");

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

describe("homework / assignments", () => {
  let instA: string;
  let sectionA: string;
  let secAhwId: string; // a homework on section A
  let math: string;
  let st1: string;
  const tok: Record<string, string> = {};

  const post = (path: string, token: string, body?: unknown) =>
    request(app).post(path).set("Authorization", `Bearer ${token}`).send(body ?? {});
  const get = (path: string, token: string) =>
    request(app).get(path).set("Authorization", `Bearer ${token}`);

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("HA");
    for (const role of ["admin", "teacher", "accountant"] as const) {
      await createUser({ email: `${role}@h.dev`, password: PW, role, institutionId: instA });
    }
    const classId = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'Grade 1', 1) RETURNING id`,
      [instA]
    );
    sectionA = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1, $2, 'A') RETURNING id`,
      [instA, classId]
    );
    const sectionB = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1, $2, 'B') RETURNING id`,
      [instA, classId]
    );
    math = await insertId(
      `INSERT INTO subjects (institution_id, name, code) VALUES ($1, 'Math', 'MATH') RETURNING id`,
      [instA]
    );
    st1 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id) VALUES ($1, 'H1', 'Ava', 'One', $2) RETURNING id`,
      [instA, sectionA]
    );
    const st2 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id) VALUES ($1, 'H2', 'Ben', 'Two', $2) RETURNING id`,
      [instA, sectionB]
    );
    const su1 = await createUser({ email: "su1@h.dev", password: PW, role: "student", institutionId: instA });
    await query(`UPDATE students SET user_id = $1 WHERE id = $2`, [su1.id, st1]);
    const su2 = await createUser({ email: "su2@h.dev", password: PW, role: "student", institutionId: instA });
    await query(`UPDATE students SET user_id = $1 WHERE id = $2`, [su2.id, st2]);
    const pu1 = await createUser({ email: "pu1@h.dev", password: PW, role: "parent", institutionId: instA });
    await query(
      `INSERT INTO guardians (institution_id, user_id, student_id, relationship) VALUES ($1, $2, $3, 'mother')`,
      [instA, pu1.id, st1]
    );

    for (const e of ["admin", "teacher", "accountant"]) tok[e] = await tokenFor(`${e}@h.dev`, PW);
    tok.su1 = await tokenFor("su1@h.dev", PW);
    tok.su2 = await tokenFor("su2@h.dev", PW);
    tok.pu1 = await tokenFor("pu1@h.dev", PW);

    // A homework on section A (created by the teacher) used by most tests.
    const created = await post("/api/v1/homework", tok.teacher, {
      sectionId: sectionA,
      subjectId: math,
      title: "Algebra worksheet",
      description: "Solve all problems.",
      dueDate: "2030-12-31",
      maxMarks: 10,
    });
    expect(created.status).toBe(201);
    secAhwId = created.body.id;
  });

  it("notifies the section's students when homework is assigned (graceful when unconfigured)", async () => {
    const inbox = await get("/api/v1/communication/inbox", tok.su1);
    expect(inbox.status).toBe(200);
    expect(inbox.body.some((m: { subject: string }) => m.subject.includes("Algebra worksheet"))).toBe(true);
  });

  it("targets by section: only that section's student/parent see it", async () => {
    expect((await get("/api/v1/homework", tok.su1)).body).toHaveLength(1); // section A student
    expect((await get("/api/v1/homework", tok.pu1)).body).toHaveLength(1); // parent of section A child
    expect((await get("/api/v1/homework", tok.su2)).body).toHaveLength(0); // section B student
    // Section B student cannot open section A homework.
    expect((await get(`/api/v1/homework/${secAhwId}`, tok.su2)).status).toBe(403);
  });

  it("lets a student submit with an attachment and a teacher review it", async () => {
    const submit = await request(app)
      .post(`/api/v1/homework/${secAhwId}/submit`)
      .set("Authorization", `Bearer ${tok.su1}`)
      .field("content", "My answer")
      .attach("file", PDF, { filename: "answer.pdf", contentType: "application/pdf" });
    expect(submit.status).toBe(201);
    expect(submit.body.status).toBe("submitted");
    expect(submit.body.attachment.id).toBeTruthy();

    const subs = await get(`/api/v1/homework/${secAhwId}/submissions`, tok.teacher);
    expect(subs.status).toBe(200);
    expect(subs.body).toHaveLength(1);
    expect(subs.body[0].attachmentCount).toBe(1);

    const review = await post(
      `/api/v1/homework/submissions/${subs.body[0].id}/review`,
      tok.teacher,
      { status: "completed", marks: 9, remarks: "Well done" }
    );
    expect(review.status).toBe(200);
    expect(review.body.status).toBe("completed");
    expect(Number(review.body.marks)).toBe(9);
  });

  it("protects attachment downloads (owner-scoped)", async () => {
    // Student submission attachment.
    const submit = await request(app)
      .post(`/api/v1/homework/${secAhwId}/submit`)
      .set("Authorization", `Bearer ${tok.su1}`)
      .attach("file", PDF, { filename: "a.pdf", contentType: "application/pdf" });
    const subDoc = submit.body.attachment.id;
    // Owner can download (bytes match); another student cannot.
    const own = await get(`/api/v1/homework/attachments/${subDoc}/download`, tok.su1)
      .buffer(true)
      .parse(binaryParser);
    expect(own.status).toBe(200);
    expect(Buffer.compare(own.body, PDF)).toBe(0);
    expect((await get(`/api/v1/homework/attachments/${subDoc}/download`, tok.su2)).status).toBe(403);

    // Teacher homework attachment: section A student can read, section B cannot.
    const att = await request(app)
      .post(`/api/v1/homework/${secAhwId}/attachments`)
      .set("Authorization", `Bearer ${tok.teacher}`)
      .attach("file", PDF, { filename: "ref.pdf", contentType: "application/pdf" });
    expect(att.status).toBe(201);
    expect((await get(`/api/v1/homework/attachments/${att.body.id}/download`, tok.su1)).status).toBe(200);
    expect((await get(`/api/v1/homework/attachments/${att.body.id}/download`, tok.su2)).status).toBe(403);
  });

  it("enforces permission guards", async () => {
    // student cannot create
    expect((await post("/api/v1/homework", tok.su1, { sectionId: sectionA, subjectId: math, title: "x" })).status).toBe(403);
    // teacher cannot submit
    expect((await post(`/api/v1/homework/${secAhwId}/submit`, tok.teacher)).status).toBe(403);
    // student cannot view submissions or review
    expect((await get(`/api/v1/homework/${secAhwId}/submissions`, tok.su1)).status).toBe(403);
    // accountant (read-only) cannot create
    expect((await post("/api/v1/homework", tok.accountant, { sectionId: sectionA, subjectId: math, title: "x" })).status).toBe(403);
    // accountant can read
    expect((await get("/api/v1/homework", tok.accountant)).status).toBe(200);
  });

  it("denies cross-institution access", async () => {
    const instB = await createInstitution("HB");
    await createUser({ email: "badmin@h.dev", password: PW, role: "admin", institutionId: instB });
    const bToken = await tokenFor("badmin@h.dev", PW);
    expect((await get(`/api/v1/homework/${secAhwId}`, bToken)).status).toBe(404);
    expect((await get(`/api/v1/homework/${secAhwId}/submissions`, bToken)).status).toBe(404);
  });
});
