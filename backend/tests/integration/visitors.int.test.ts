import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";

describe("front office / visitors (/visitors)", () => {
  let instA: string;
  let instB: string;
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("VIS");
    instB = await createInstitution("VIS2");
    await createUser({ email: "admin@va.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "admin@vb.dev", password: PW, role: "admin", institutionId: instB });
    await createUser({ email: "super@v.dev", password: PW, role: "super_admin", institutionId: null });
    tok.adminA = await tokenFor("admin@va.dev", PW);
    tok.adminB = await tokenFor("admin@vb.dev", PW);
    tok.super = await tokenFor("super@v.dev", PW);
  });

  it("requires auth + tenant context", async () => {
    expect((await request(app).get("/api/v1/visitors")).status).toBe(401);
    expect((await request(app).get("/api/v1/visitors").set(auth(tok.super))).status).toBe(403);
  });

  it("checks a visitor in, lists active, then checks out (once)", async () => {
    const created = await request(app)
      .post("/api/v1/visitors")
      .set(auth(tok.adminA))
      .send({ visitorName: "Ravi", purpose: "Meeting", whomToMeet: "Principal" });
    expect(created.status).toBe(201);
    expect(created.body.outTime).toBeNull();
    const id = created.body.id as string;

    const active = await request(app).get("/api/v1/visitors?active=true").set(auth(tok.adminA));
    expect(active.body.meta.total).toBe(1);

    const out = await request(app)
      .post(`/api/v1/visitors/${id}/checkout`)
      .set(auth(tok.adminA));
    expect(out.status).toBe(200);
    expect(out.body.outTime).not.toBeNull();

    const activeAfter = await request(app)
      .get("/api/v1/visitors?active=true")
      .set(auth(tok.adminA));
    expect(activeAfter.body.meta.total).toBe(0);

    // Checking out again is rejected.
    expect(
      (await request(app).post(`/api/v1/visitors/${id}/checkout`).set(auth(tok.adminA))).status
    ).toBe(400);
  });

  it("isolates tenants — admin B cannot read admin A's visitor", async () => {
    const created = await request(app)
      .post("/api/v1/visitors")
      .set(auth(tok.adminA))
      .send({ visitorName: "X" });
    const id = created.body.id as string;
    expect(
      (await request(app).get(`/api/v1/visitors/${id}`).set(auth(tok.adminB))).status
    ).toBe(404);
  });
});
