import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";

// PR-T9.2 — student read-only access to OWN leave via GET /student-leave/my.
// Additive widening of the read path only: a student user (students.user_id
// link) sees exactly their own requests; they still cannot file, cancel,
// approve, reject, or read other students' / staff surfaces. Parent behavior
// is unchanged. Tenant-scoped throughout.

const PW = "Passw0rd!";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("PR-T9.2 student own-leave read", () => {
  let instA: string;
  let instB: string;
  let mine: string; // student row linked to the student login
  let other: string; // classmate — must never be visible to the student login
  let leaveMineId: string;
  const tok: Record<string, string> = {};

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("T92A", "school");
    instB = await createInstitution("T92B", "school");
    await createUser({ email: "admin@t92a.dev", password: PW, role: "admin", institutionId: instA });
    const studentUser = await createUser({ email: "student@t92a.dev", password: PW, role: "student", institutionId: instA });
    const parent = await createUser({ email: "parent@t92a.dev", password: PW, role: "parent", institutionId: instA });
    await createUser({ email: "admin@t92b.dev", password: PW, role: "admin", institutionId: instB });
    tok.adminA = await tokenFor("admin@t92a.dev", PW);
    tok.studentA = await tokenFor("student@t92a.dev", PW);
    tok.parentA = await tokenFor("parent@t92a.dev", PW);
    tok.adminB = await tokenFor("admin@t92b.dev", PW);

    mine = (await request(app).post("/api/v1/students").set(auth(tok.adminA)).send({ firstName: "Meena", lastName: "Mine" })).body.id;
    other = (await request(app).post("/api/v1/students").set(auth(tok.adminA)).send({ firstName: "Ojas", lastName: "Other" })).body.id;
    await query("UPDATE students SET user_id = $1 WHERE id = $2", [studentUser.id, mine]);
    await query(`INSERT INTO guardians (institution_id, user_id, student_id, relationship) VALUES ($1,$2,$3,'mother')`, [instA, parent.id, mine]);

    // One leave for the student's own row, one for the classmate (both staff-filed).
    leaveMineId = (
      await request(app).post("/api/v1/student-leave").set(auth(tok.adminA))
        .send({ studentId: mine, type: "sick", fromDate: "2026-09-10", toDate: "2026-09-11", reason: "Own leave" })
    ).body.id;
    await request(app).post("/api/v1/student-leave").set(auth(tok.adminA))
      .send({ studentId: other, type: "casual", fromDate: "2026-09-10", toDate: "2026-09-10", reason: "Classmate leave" });
  });

  it("student reads exactly their own leave — never the classmate's", async () => {
    const res = await request(app).get("/api/v1/student-leave/my").set(auth(tok.studentA));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(leaveMineId);
    expect(res.body[0].studentId).toBe(mine);
    expect(res.body[0].reason).toBe("Own leave");
    const ids = res.body.map((r: { studentId: string }) => r.studentId);
    expect(ids).not.toContain(other);
  });

  it("parent behavior is unchanged: sees the linked child's rows, not the classmate's", async () => {
    const res = await request(app).get("/api/v1/student-leave/my").set(auth(tok.parentA));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].studentId).toBe(mine);
  });

  it("a student user with no linked student row still gets an empty list", async () => {
    await createUser({ email: "loose@t92a.dev", password: PW, role: "student", institutionId: instA });
    const loose = await tokenFor("loose@t92a.dev", PW);
    const res = await request(app).get("/api/v1/student-leave/my").set(auth(loose));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("read-only: student cannot file leave via /my", async () => {
    const res = await request(app).post("/api/v1/student-leave/my").set(auth(tok.studentA))
      .send({ studentId: mine, fromDate: "2026-09-20", toDate: "2026-09-20" });
    expect(res.status).toBe(403);
  });

  it("read-only: student cannot cancel a request via /my/:id", async () => {
    const res = await request(app).delete(`/api/v1/student-leave/my/${leaveMineId}`).set(auth(tok.studentA));
    expect(res.status).toBe(403);
  });

  it("student cannot approve, reject, or use the staff surface", async () => {
    expect((await request(app).post(`/api/v1/student-leave/${leaveMineId}/approve`).set(auth(tok.studentA)).send({})).status).toBe(403);
    expect((await request(app).post(`/api/v1/student-leave/${leaveMineId}/reject`).set(auth(tok.studentA)).send({})).status).toBe(403);
    expect((await request(app).get("/api/v1/student-leave").set(auth(tok.studentA))).status).toBe(403);
    expect((await request(app).get(`/api/v1/student-leave/${leaveMineId}`).set(auth(tok.studentA))).status).toBe(403);
    expect((await request(app).delete(`/api/v1/student-leave/${leaveMineId}`).set(auth(tok.studentA))).status).toBe(403);
  });

  it("tenant isolation: the same read path never crosses institutions", async () => {
    // Tenant B admin files leave for a tenant B student; tenant A's student
    // login must still see only their single tenant A row.
    const foreign = (await request(app).post("/api/v1/students").set(auth(tok.adminB)).send({ firstName: "Zara", lastName: "Zeta" })).body.id;
    await request(app).post("/api/v1/student-leave").set(auth(tok.adminB))
      .send({ studentId: foreign, fromDate: "2026-09-10", toDate: "2026-09-10" });
    const res = await request(app).get("/api/v1/student-leave/my").set(auth(tok.studentA));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].studentId).toBe(mine);
  });
});
