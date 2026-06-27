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

describe("academics: section subject assignments (class_subjects)", () => {
  let instA: string;
  let sectionA: string;
  let math: string;
  let science: string;
  let teacherRec: string;
  const tok: Record<string, string> = {};

  const post = (path: string, token: string, body?: unknown) =>
    request(app)
      .post(path)
      .set("Authorization", `Bearer ${token}`)
      .send(body ?? {});
  const get = (path: string, token: string) =>
    request(app).get(path).set("Authorization", `Bearer ${token}`);
  const patch = (path: string, token: string, body?: unknown) =>
    request(app)
      .patch(path)
      .set("Authorization", `Bearer ${token}`)
      .send(body ?? {});
  const del = (path: string, token: string) =>
    request(app).delete(path).set("Authorization", `Bearer ${token}`);

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("AC");
    for (const role of ["admin", "teacher", "accountant"] as const) {
      await createUser({
        email: `${role}@ac.dev`,
        password: PW,
        role,
        institutionId: instA,
      });
      tok[role] = await tokenFor(`${role}@ac.dev`, PW);
    }
    const classId = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'Grade 1', 1) RETURNING id`,
      [instA]
    );
    sectionA = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1, $2, 'A') RETURNING id`,
      [instA, classId]
    );
    math = await insertId(
      `INSERT INTO subjects (institution_id, name, code) VALUES ($1, 'Math', 'MATH') RETURNING id`,
      [instA]
    );
    science = await insertId(
      `INSERT INTO subjects (institution_id, name, code) VALUES ($1, 'Science', 'SCI') RETURNING id`,
      [instA]
    );
    teacherRec = await insertId(
      `INSERT INTO teachers (institution_id, employee_no, first_name, last_name)
       VALUES ($1, 'T-AC-1', 'Asha', 'Rao') RETURNING id`,
      [instA]
    );
  });

  it("assigns a subject with a teacher and lists it enriched", async () => {
    const created = await post(`/api/v1/sections/${sectionA}/subjects`, tok.admin, {
      subjectId: math,
      teacherId: teacherRec,
    });
    expect(created.status).toBe(201);
    expect(created.body.subjectName).toBe("Math");
    expect(created.body.teacherName).toBe("Asha Rao");

    const listed = await get(`/api/v1/sections/${sectionA}/subjects`, tok.admin);
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0]).toMatchObject({
      subjectId: math,
      subjectCode: "MATH",
      teacherId: teacherRec,
      teacherName: "Asha Rao",
    });
  });

  it("assigns a subject without a teacher (teacher fields null)", async () => {
    const created = await post(`/api/v1/sections/${sectionA}/subjects`, tok.admin, {
      subjectId: science,
    });
    expect(created.status).toBe(201);
    expect(created.body.teacherId).toBeNull();
    expect(created.body.teacherName).toBeNull();
  });

  it("reassigns and clears the teacher via PATCH", async () => {
    const created = await post(`/api/v1/sections/${sectionA}/subjects`, tok.admin, {
      subjectId: math,
    });
    const id = created.body.id;

    const assigned = await patch(`/api/v1/class-subjects/${id}`, tok.admin, {
      teacherId: teacherRec,
    });
    expect(assigned.status).toBe(200);
    expect(assigned.body.teacherId).toBe(teacherRec);

    const cleared = await patch(`/api/v1/class-subjects/${id}`, tok.admin, {
      teacherId: null,
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.teacherId).toBeNull();
  });

  it("rejects assigning the same subject to a section twice", async () => {
    expect(
      (await post(`/api/v1/sections/${sectionA}/subjects`, tok.admin, { subjectId: math }))
        .status
    ).toBe(201);
    const dup = await post(`/api/v1/sections/${sectionA}/subjects`, tok.admin, {
      subjectId: math,
    });
    expect(dup.status).toBe(400);
  });

  it("removes an assignment", async () => {
    const created = await post(`/api/v1/sections/${sectionA}/subjects`, tok.admin, {
      subjectId: math,
    });
    const removed = await del(`/api/v1/class-subjects/${created.body.id}`, tok.admin);
    expect(removed.status).toBe(204);
    expect((await get(`/api/v1/sections/${sectionA}/subjects`, tok.admin)).body).toHaveLength(0);
    // Removing again is a 404.
    expect((await del(`/api/v1/class-subjects/${created.body.id}`, tok.admin)).status).toBe(404);
  });

  it("validates referenced subject and teacher belong to the tenant", async () => {
    const instB = await createInstitution("AD");
    const otherSubject = await insertId(
      `INSERT INTO subjects (institution_id, name, code) VALUES ($1, 'Art', 'ART') RETURNING id`,
      [instB]
    );
    const otherTeacher = await insertId(
      `INSERT INTO teachers (institution_id, employee_no, first_name, last_name)
       VALUES ($1, 'T-AD-1', 'Bob', 'Lee') RETURNING id`,
      [instB]
    );
    expect(
      (await post(`/api/v1/sections/${sectionA}/subjects`, tok.admin, { subjectId: otherSubject }))
        .status
    ).toBe(404);
    expect(
      (
        await post(`/api/v1/sections/${sectionA}/subjects`, tok.admin, {
          subjectId: math,
          teacherId: otherTeacher,
        })
      ).status
    ).toBe(404);
  });

  it("enforces role guards (admin writes; others read-only)", async () => {
    // Non-admins cannot assign.
    expect(
      (await post(`/api/v1/sections/${sectionA}/subjects`, tok.teacher, { subjectId: math }))
        .status
    ).toBe(403);
    expect(
      (await post(`/api/v1/sections/${sectionA}/subjects`, tok.accountant, { subjectId: math }))
        .status
    ).toBe(403);

    // Admin assigns, then non-admins can read but not mutate.
    const created = await post(`/api/v1/sections/${sectionA}/subjects`, tok.admin, {
      subjectId: math,
    });
    const id = created.body.id;
    expect((await get(`/api/v1/sections/${sectionA}/subjects`, tok.teacher)).status).toBe(200);
    expect((await patch(`/api/v1/class-subjects/${id}`, tok.teacher, { teacherId: null })).status).toBe(403);
    expect((await del(`/api/v1/class-subjects/${id}`, tok.accountant)).status).toBe(403);
  });

  it("isolates assignments across institutions", async () => {
    const instB = await createInstitution("AE");
    await createUser({ email: "badmin@ac.dev", password: PW, role: "admin", institutionId: instB });
    const bToken = await tokenFor("badmin@ac.dev", PW);

    await post(`/api/v1/sections/${sectionA}/subjects`, tok.admin, { subjectId: math });

    // Inst B admin cannot read or write inst A's section.
    expect((await get(`/api/v1/sections/${sectionA}/subjects`, bToken)).status).toBe(404);
    expect(
      (await post(`/api/v1/sections/${sectionA}/subjects`, bToken, { subjectId: math })).status
    ).toBe(404);
  });
});
