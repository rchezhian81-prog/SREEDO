import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";

describe("feedback / grievance (/feedback)", () => {
  let instA: string;
  let instB: string;
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("FDBK");
    instB = await createInstitution("FDBK2");
    await createUser({ email: "admin@fda.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "admin@fdb.dev", password: PW, role: "admin", institutionId: instB });
    await createUser({ email: "super@fd.dev", password: PW, role: "super_admin", institutionId: null });
    tok.adminA = await tokenFor("admin@fda.dev", PW);
    tok.adminB = await tokenFor("admin@fdb.dev", PW);
    tok.super = await tokenFor("super@fd.dev", PW);
  });

  it("requires auth + tenant context", async () => {
    expect((await request(app).get("/api/v1/feedback")).status).toBe(401);
    expect((await request(app).get("/api/v1/feedback").set(auth(tok.super))).status).toBe(403);
  });

  it("accepts public submission, then admin tracks + resolves it", async () => {
    const sub = await request(app)
      .post("/api/v1/feedback/submit")
      .send({ institutionCode: "FDBK", type: "complaint", subject: "Bus late", message: "30 min late" });
    expect(sub.status).toBe(201);
    expect(sub.body.status).toBe("open");

    expect(
      (await request(app).post("/api/v1/feedback/submit").send({ institutionCode: "NOPE", subject: "x", message: "y" })).status
    ).toBe(404);

    const list = await request(app).get("/api/v1/feedback").set(auth(tok.adminA));
    expect(list.body.meta.total).toBe(1);
    const id = list.body.data[0].id as string;

    const upd = await request(app)
      .patch(`/api/v1/feedback/${id}`)
      .set(auth(tok.adminA))
      .send({ status: "resolved", resolution: "Spoke to the driver" });
    expect(upd.status).toBe(200);
    expect(upd.body.status).toBe("resolved");

    const resolved = await request(app)
      .get("/api/v1/feedback?status=resolved")
      .set(auth(tok.adminA));
    expect(resolved.body.meta.total).toBe(1);
  });

  it("lets an admin log and delete an entry", async () => {
    const created = await request(app)
      .post("/api/v1/feedback")
      .set(auth(tok.adminA))
      .send({ subject: "S", message: "M" });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    expect(
      (await request(app).delete(`/api/v1/feedback/${id}`).set(auth(tok.adminA))).status
    ).toBe(204);
  });

  it("isolates tenants — admin B cannot read admin A's entry", async () => {
    const created = await request(app)
      .post("/api/v1/feedback")
      .set(auth(tok.adminA))
      .send({ subject: "S", message: "M" });
    const id = created.body.id as string;
    expect(
      (await request(app).get(`/api/v1/feedback/${id}`).set(auth(tok.adminB))).status
    ).toBe(404);
  });
});
