import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  app,
  createInstitution,
  createUser,
  resetDb,
  tokenFor,
} from "./helpers";

const PW = "Passw0rd!";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const sample = {
  title: "Algebra revision",
  subject: "Mathematics",
  target: "Grade 9 - A",
  provider: "meet",
  joinUrl: "https://meet.example.com/abc-defg-hij",
  scheduledAt: "2026-07-01T10:00:00.000Z",
  durationMin: 45,
};

describe("live classes", () => {
  let adminTok: string;
  let teacherTok: string;
  let studentTok: string;
  let otherAdminTok: string;

  beforeEach(async () => {
    await resetDb();
    const inst = await createInstitution("LC", "school");
    const other = await createInstitution("LC2", "school");
    await createUser({ email: "admin@lc.dev", password: PW, role: "admin", institutionId: inst });
    await createUser({ email: "teacher@lc.dev", password: PW, role: "teacher", institutionId: inst });
    await createUser({ email: "student@lc.dev", password: PW, role: "student", institutionId: inst });
    await createUser({ email: "admin@lc2.dev", password: PW, role: "admin", institutionId: other });
    adminTok = await tokenFor("admin@lc.dev", PW);
    teacherTok = await tokenFor("teacher@lc.dev", PW);
    studentTok = await tokenFor("student@lc.dev", PW);
    otherAdminTok = await tokenFor("admin@lc2.dev", PW);
  });

  it("lets admins and teachers schedule, but not students", async () => {
    const a = await request(app).post("/api/v1/live-classes").set(auth(adminTok)).send(sample);
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ title: "Algebra revision", provider: "meet", status: "scheduled" });

    const t = await request(app).post("/api/v1/live-classes").set(auth(teacherTok)).send(sample);
    expect(t.status).toBe(201);

    const s = await request(app).post("/api/v1/live-classes").set(auth(studentTok)).send(sample);
    expect(s.status).toBe(403);
  });

  it("lists the tenant's classes and isolates other tenants", async () => {
    await request(app).post("/api/v1/live-classes").set(auth(adminTok)).send(sample);

    const mine = await request(app).get("/api/v1/live-classes").set(auth(adminTok));
    expect(mine.status).toBe(200);
    expect(mine.body).toHaveLength(1);

    const others = await request(app).get("/api/v1/live-classes").set(auth(otherAdminTok));
    expect(others.body).toHaveLength(0);
  });

  it("updates status and deletes", async () => {
    const created = await request(app).post("/api/v1/live-classes").set(auth(adminTok)).send(sample);
    const id = created.body.id as string;

    const upd = await request(app)
      .patch(`/api/v1/live-classes/${id}`)
      .set(auth(teacherTok))
      .send({ status: "completed" });
    expect(upd.status).toBe(200);
    expect(upd.body.status).toBe("completed");

    const del = await request(app).delete(`/api/v1/live-classes/${id}`).set(auth(adminTok));
    expect(del.status).toBe(204);

    const after = await request(app).get("/api/v1/live-classes").set(auth(adminTok));
    expect(after.body).toHaveLength(0);
  });

  it("rejects an invalid join url", async () => {
    const bad = await request(app)
      .post("/api/v1/live-classes")
      .set(auth(adminTok))
      .send({ ...sample, joinUrl: "not-a-url" });
    expect(bad.status).toBe(400);
  });
});
