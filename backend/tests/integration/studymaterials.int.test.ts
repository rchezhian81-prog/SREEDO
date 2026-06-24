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

describe("study materials / LMS (/study-materials, /portal)", () => {
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
    instA = await createInstitution("SM");
    instB = await createInstitution("SM2");

    await createUser({ email: "admin@sm.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "teacher@sm.dev", password: PW, role: "teacher", institutionId: instA });
    await createUser({ email: "admin@sm2.dev", password: PW, role: "admin", institutionId: instB });
    await createUser({ email: "super@sm.dev", password: PW, role: "super_admin", institutionId: null });

    classId = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'Grade 5', 5) RETURNING id`,
      [instA]
    );
    classB2 = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'Grade 6', 6) RETURNING id`,
      [instA]
    );
    const sectionA = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1, $2, 'A') RETURNING id`,
      [instA, classId]
    );
    subjectId = await insertId(
      `INSERT INTO subjects (institution_id, name, code) VALUES ($1, 'Science', 'SCI-SM') RETURNING id`,
      [instA]
    );
    s1 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id) VALUES ($1, 'SM-1', 'Meera', 'Iyer', $2) RETURNING id`,
      [instA, sectionA]
    );
    const studentUser = await createUser({
      email: "stud@sm.dev", password: PW, role: "student", institutionId: instA,
    });
    await query(`UPDATE students SET user_id = $1 WHERE id = $2`, [studentUser.id, s1]);

    tok.admin = await tokenFor("admin@sm.dev", PW);
    tok.teacher = await tokenFor("teacher@sm.dev", PW);
    tok.adminB = await tokenFor("admin@sm2.dev", PW);
    tok.super = await tokenFor("super@sm.dev", PW);
    tok.student = await tokenFor("stud@sm.dev", PW);
  });

  it("requires auth + tenant + staff role", async () => {
    expect((await request(app).get("/api/v1/study-materials")).status).toBe(401);
    expect((await request(app).get("/api/v1/study-materials").set(auth(tok.super))).status).toBe(403);
    // A student is not staff — cannot use the management API.
    expect((await request(app).get("/api/v1/study-materials").set(auth(tok.student))).status).toBe(403);
  });

  it("teacher & admin publish, list (filter class/subject, search), update, delete", async () => {
    const forClass = await request(app)
      .post("/api/v1/study-materials")
      .set(auth(tok.teacher))
      .send({ title: "Photosynthesis notes", fileUrl: "https://ex.com/p.pdf", classId, subjectId });
    expect(forClass.status).toBe(201);
    expect(forClass.body.className).toBe("Grade 5");
    expect(forClass.body.subjectName).toBe("Science");
    const id = forClass.body.id as string;

    // School-wide (no class) by admin.
    await request(app)
      .post("/api/v1/study-materials")
      .set(auth(tok.admin))
      .send({ title: "Exam calendar", fileUrl: "https://ex.com/cal.pdf" });

    // Another class's material — student in Grade 5 must NOT see this.
    await request(app)
      .post("/api/v1/study-materials")
      .set(auth(tok.teacher))
      .send({ title: "Grade 6 algebra", fileUrl: "https://ex.com/a.pdf", classId: classB2 });

    const all = await request(app).get("/api/v1/study-materials").set(auth(tok.teacher));
    expect(all.body.meta.total).toBe(3);

    const byClass = await request(app)
      .get(`/api/v1/study-materials?classId=${classId}`)
      .set(auth(tok.admin));
    expect(byClass.body.meta.total).toBe(1);

    const bySubject = await request(app)
      .get(`/api/v1/study-materials?subjectId=${subjectId}`)
      .set(auth(tok.admin));
    expect(bySubject.body.meta.total).toBe(1);

    const bySearch = await request(app)
      .get("/api/v1/study-materials?search=algebra")
      .set(auth(tok.admin));
    expect(bySearch.body.meta.total).toBe(1);

    const upd = await request(app)
      .patch(`/api/v1/study-materials/${id}`)
      .set(auth(tok.teacher))
      .send({ title: "Photosynthesis (updated)" });
    expect(upd.body.title).toBe("Photosynthesis (updated)");

    expect(
      (await request(app).delete(`/api/v1/study-materials/${id}`).set(auth(tok.admin))).status
    ).toBe(204);
  });

  it("rejects a non-URL fileUrl", async () => {
    const res = await request(app)
      .post("/api/v1/study-materials")
      .set(auth(tok.teacher))
      .send({ title: "Bad", fileUrl: "not a url" });
    expect(res.status).toBe(400);
  });

  it("student sees their class's materials + school-wide via the portal (not other classes)", async () => {
    await request(app).post("/api/v1/study-materials").set(auth(tok.teacher))
      .send({ title: "Class material", fileUrl: "https://ex.com/c.pdf", classId });
    await request(app).post("/api/v1/study-materials").set(auth(tok.admin))
      .send({ title: "Whole school", fileUrl: "https://ex.com/w.pdf" });
    await request(app).post("/api/v1/study-materials").set(auth(tok.teacher))
      .send({ title: "Other class", fileUrl: "https://ex.com/o.pdf", classId: classB2 });

    const portal = await request(app)
      .get(`/api/v1/portal/students/${s1}/materials`)
      .set(auth(tok.student));
    expect(portal.status).toBe(200);
    const titles = (portal.body as { title: string }[]).map((m) => m.title).sort();
    expect(titles).toEqual(["Class material", "Whole school"]);
  });

  it("isolates tenants — admin B cannot read admin A's material", async () => {
    const created = await request(app)
      .post("/api/v1/study-materials")
      .set(auth(tok.teacher))
      .send({ title: "X", fileUrl: "https://ex.com/x.pdf", classId });
    const id = created.body.id as string;
    expect(
      (await request(app).get(`/api/v1/study-materials/${id}`).set(auth(tok.adminB))).status
    ).toBe(404);
  });
});
