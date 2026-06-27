import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";

describe("alumni directory (/alumni)", () => {
  let instA: string;
  let instB: string;
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("ALM");
    instB = await createInstitution("ALM2");
    await createUser({ email: "admin@aa.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "admin@ab.dev", password: PW, role: "admin", institutionId: instB });
    await createUser({ email: "super@a.dev", password: PW, role: "super_admin", institutionId: null });
    tok.adminA = await tokenFor("admin@aa.dev", PW);
    tok.adminB = await tokenFor("admin@ab.dev", PW);
    tok.super = await tokenFor("super@a.dev", PW);
  });

  it("requires auth + tenant context", async () => {
    expect((await request(app).get("/api/v1/alumni")).status).toBe(401);
    expect((await request(app).get("/api/v1/alumni").set(auth(tok.super))).status).toBe(403);
  });

  it("adds, lists (with batch filter + search), updates, and deletes an alumnus", async () => {
    const created = await request(app)
      .post("/api/v1/alumni")
      .set(auth(tok.adminA))
      .send({ fullName: "Asha Rao", batchYear: 2018, currentCompany: "Acme", email: "asha@x.dev" });
    expect(created.status).toBe(201);
    expect(created.body.batchYear).toBe(2018);
    const id = created.body.id as string;

    await request(app)
      .post("/api/v1/alumni")
      .set(auth(tok.adminA))
      .send({ fullName: "Ravi Kumar", batchYear: 2020, currentCompany: "Globex" });

    const all = await request(app).get("/api/v1/alumni").set(auth(tok.adminA));
    expect(all.body.meta.total).toBe(2);
    // Default order is newest batch first.
    expect(all.body.data[0].batchYear).toBe(2020);

    const byBatch = await request(app)
      .get("/api/v1/alumni?batchYear=2018")
      .set(auth(tok.adminA));
    expect(byBatch.body.meta.total).toBe(1);

    const bySearch = await request(app)
      .get("/api/v1/alumni?search=Globex")
      .set(auth(tok.adminA));
    expect(bySearch.body.meta.total).toBe(1);
    expect(bySearch.body.data[0].fullName).toBe("Ravi Kumar");

    const upd = await request(app)
      .patch(`/api/v1/alumni/${id}`)
      .set(auth(tok.adminA))
      .send({ currentRole: "CTO", currentCompany: "Acme Corp" });
    expect(upd.body.currentRole).toBe("CTO");
    expect(upd.body.currentCompany).toBe("Acme Corp");

    expect(
      (await request(app).delete(`/api/v1/alumni/${id}`).set(auth(tok.adminA))).status
    ).toBe(204);
  });

  it("rejects an invalid batch year", async () => {
    const res = await request(app)
      .post("/api/v1/alumni")
      .set(auth(tok.adminA))
      .send({ fullName: "Bad Year", batchYear: 1500 });
    expect(res.status).toBe(400);
  });

  it("isolates tenants — admin B cannot read admin A's alumnus", async () => {
    const created = await request(app)
      .post("/api/v1/alumni")
      .set(auth(tok.adminA))
      .send({ fullName: "X", batchYear: 2019 });
    const id = created.body.id as string;
    expect(
      (await request(app).get(`/api/v1/alumni/${id}`).set(auth(tok.adminB))).status
    ).toBe(404);
  });
});
