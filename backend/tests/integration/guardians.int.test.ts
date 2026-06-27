import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  app,
  createInstitution,
  createUser,
  query,
  resetDb,
  tokenFor,
} from "./helpers";

/** Resolves a user id by email (test helper). */
async function userId(email: string): Promise<string> {
  const { rows } = await query<{ id: string }>(
    "SELECT id FROM users WHERE email = $1",
    [email]
  );
  return rows[0].id;
}

describe("student guardians (/students/:id/guardians)", () => {
  let institutionId: string;
  let adminToken: string;
  let parentToken: string;
  let parentId: string;
  let studentId: string;

  beforeAll(async () => {
    await resetDb();
    institutionId = await createInstitution("GRD");
    await createUser({
      email: "admin@grd.edu",
      password: "Admin@12345",
      role: "admin",
      institutionId,
    });
    adminToken = await tokenFor("admin@grd.edu", "Admin@12345");
    await createUser({
      email: "parent@grd.edu",
      password: "Parent@12345",
      role: "parent",
      fullName: "Pat Parent",
      institutionId,
    });
    parentToken = await tokenFor("parent@grd.edu", "Parent@12345");
    parentId = await userId("parent@grd.edu");

    const created = await request(app)
      .post("/api/v1/students")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "Sam", lastName: "Student" });
    studentId = created.body.id;
  });

  afterAll(async () => {
    await resetDb();
  });

  it("forbids a non-admin from managing guardians", async () => {
    const res = await request(app)
      .get(`/api/v1/students/${studentId}/guardians`)
      .set("Authorization", `Bearer ${parentToken}`);
    expect(res.status).toBe(403);
  });

  it("links a parent, lists it, and the parent then sees the child in the portal", async () => {
    const link = await request(app)
      .post(`/api/v1/students/${studentId}/guardians`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ userId: parentId, relationship: "father" });
    expect(link.status).toBe(201);
    expect(link.body).toMatchObject({
      userId: parentId,
      relationship: "father",
      fullName: "Pat Parent",
    });

    const list = await request(app)
      .get(`/api/v1/students/${studentId}/guardians`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    // Loop closed: the parent portal now resolves the linked child.
    const children = await request(app)
      .get("/api/v1/portal/children")
      .set("Authorization", `Bearer ${parentToken}`);
    expect(children.status).toBe(200);
    expect(children.body.map((c: { id: string }) => c.id)).toContain(studentId);
  });

  it("rejects a duplicate link", async () => {
    const res = await request(app)
      .post(`/api/v1/students/${studentId}/guardians`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ userId: parentId });
    expect(res.status).toBe(409);
  });

  it("rejects linking a non-parent account", async () => {
    await createUser({
      email: "teacher@grd.edu",
      password: "Teach@12345",
      role: "teacher",
      institutionId,
    });
    const res = await request(app)
      .post(`/api/v1/students/${studentId}/guardians`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ userId: await userId("teacher@grd.edu") });
    expect(res.status).toBe(400);
  });

  it("unlinks a guardian", async () => {
    const list = await request(app)
      .get(`/api/v1/students/${studentId}/guardians`)
      .set("Authorization", `Bearer ${adminToken}`);
    const guardianId = list.body[0].id;

    const del = await request(app)
      .delete(`/api/v1/students/${studentId}/guardians/${guardianId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(del.status).toBe(204);

    const after = await request(app)
      .get(`/api/v1/students/${studentId}/guardians`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(after.body).toHaveLength(0);
  });

  it("is tenant-scoped: another institution's admin cannot see the student", async () => {
    const otherInst = await createInstitution("GRD2");
    await createUser({
      email: "admin2@grd2.edu",
      password: "Admin@12345",
      role: "admin",
      institutionId: otherInst,
    });
    const admin2 = await tokenFor("admin2@grd2.edu", "Admin@12345");
    const res = await request(app)
      .get(`/api/v1/students/${studentId}/guardians`)
      .set("Authorization", `Bearer ${admin2}`);
    expect(res.status).toBe(404);
  });
});
