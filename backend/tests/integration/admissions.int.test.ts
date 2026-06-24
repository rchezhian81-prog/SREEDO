import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";

describe("admissions (/admissions)", () => {
  let instA: string;
  let instB: string;
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("ADMSN");
    instB = await createInstitution("ADMSN2");
    await createUser({ email: "admin@a.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "admin@b.dev", password: PW, role: "admin", institutionId: instB });
    await createUser({ email: "super@a.dev", password: PW, role: "super_admin", institutionId: null });
    tok.adminA = await tokenFor("admin@a.dev", PW);
    tok.adminB = await tokenFor("admin@b.dev", PW);
    tok.super = await tokenFor("super@a.dev", PW);
  });

  it("requires auth and is institution-admin only", async () => {
    expect((await request(app).get("/api/v1/admissions")).status).toBe(401);
    // super_admin has no tenant context -> rejected by requireTenant.
    expect(
      (await request(app).get("/api/v1/admissions").set(auth(tok.super))).status
    ).toBe(403);
  });

  it("creates, lists, updates status, and converts an application into a student", async () => {
    const created = await request(app)
      .post("/api/v1/admissions")
      .set(auth(tok.adminA))
      .send({ firstName: "Asha", lastName: "Rao", gradeApplying: "Grade 1", guardianPhone: "999000" });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("enquiry");
    const id = created.body.id as string;

    const list = await request(app).get("/api/v1/admissions").set(auth(tok.adminA));
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBe(1);

    const upd = await request(app)
      .patch(`/api/v1/admissions/${id}`)
      .set(auth(tok.adminA))
      .send({ status: "admitted" });
    expect(upd.status).toBe(200);
    expect(upd.body.status).toBe("admitted");

    const conv = await request(app)
      .post(`/api/v1/admissions/${id}/convert`)
      .set(auth(tok.adminA))
      .send({});
    expect(conv.status).toBe(200);
    expect(conv.body.student.firstName).toBe("Asha");
    expect(conv.body.application.status).toBe("enrolled");
    expect(conv.body.application.studentId).toBe(conv.body.student.id);

    // The enrolled student now appears in the students list.
    const students = await request(app).get("/api/v1/students").set(auth(tok.adminA));
    expect(
      students.body.data.some((s: { firstName: string }) => s.firstName === "Asha")
    ).toBe(true);

    // Converting a second time is rejected.
    const again = await request(app)
      .post(`/api/v1/admissions/${id}/convert`)
      .set(auth(tok.adminA))
      .send({});
    expect(again.status).toBe(400);
  });

  it("isolates tenants — admin B cannot read admin A's application", async () => {
    const created = await request(app)
      .post("/api/v1/admissions")
      .set(auth(tok.adminA))
      .send({ firstName: "X", lastName: "Y" });
    const id = created.body.id as string;
    expect(
      (await request(app).get(`/api/v1/admissions/${id}`).set(auth(tok.adminB))).status
    ).toBe(404);
  });

  it("accepts a public enquiry by school code and rejects unknown codes", async () => {
    const ok = await request(app)
      .post("/api/v1/admissions/enquiry")
      .send({ institutionCode: "ADMSN", firstName: "Web", lastName: "Lead", guardianPhone: "12345" });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe("enquiry");

    const bad = await request(app)
      .post("/api/v1/admissions/enquiry")
      .send({ institutionCode: "NOPE", firstName: "Web", lastName: "Lead" });
    expect(bad.status).toBe(404);

    // The enquiry is visible to that school's admin, tagged source=website.
    const list = await request(app).get("/api/v1/admissions").set(auth(tok.adminA));
    expect(
      list.body.data.some((a: { source: string | null }) => a.source === "website")
    ).toBe(true);
  });
});
