import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";

describe("lost & found (/lost-found)", () => {
  let instA: string;
  let instB: string;
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("LF");
    instB = await createInstitution("LF2");
    await createUser({ email: "admin@lf.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "admin@lf2.dev", password: PW, role: "admin", institutionId: instB });
    await createUser({ email: "super@lf.dev", password: PW, role: "super_admin", institutionId: null });
    tok.admin = await tokenFor("admin@lf.dev", PW);
    tok.adminB = await tokenFor("admin@lf2.dev", PW);
    tok.super = await tokenFor("super@lf.dev", PW);
  });

  it("requires auth + tenant context", async () => {
    expect((await request(app).get("/api/v1/lost-found")).status).toBe(401);
    expect((await request(app).get("/api/v1/lost-found").set(auth(tok.super))).status).toBe(403);
  });

  it("logs items, filters, updates status, and deletes", async () => {
    const created = await request(app)
      .post("/api/v1/lost-found")
      .set(auth(tok.admin))
      .send({ type: "found", title: "Blue water bottle", location: "Playground" });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("open");
    const id = created.body.id as string;

    await request(app)
      .post("/api/v1/lost-found")
      .set(auth(tok.admin))
      .send({ type: "lost", title: "Math textbook" });

    const all = await request(app).get("/api/v1/lost-found").set(auth(tok.admin));
    expect(all.body.meta.total).toBe(2);

    const found = await request(app).get("/api/v1/lost-found?type=found").set(auth(tok.admin));
    expect(found.body.meta.total).toBe(1);

    const search = await request(app).get("/api/v1/lost-found?search=bottle").set(auth(tok.admin));
    expect(search.body.meta.total).toBe(1);

    const upd = await request(app)
      .patch(`/api/v1/lost-found/${id}`)
      .set(auth(tok.admin))
      .send({ status: "returned" });
    expect(upd.body.status).toBe("returned");

    expect(
      (await request(app).delete(`/api/v1/lost-found/${id}`).set(auth(tok.admin))).status
    ).toBe(204);
  });

  it("isolates tenants", async () => {
    const created = await request(app)
      .post("/api/v1/lost-found")
      .set(auth(tok.admin))
      .send({ title: "Wallet" });
    const id = created.body.id as string;
    expect(
      (await request(app).get(`/api/v1/lost-found/${id}`).set(auth(tok.adminB))).status
    ).toBe(404);
  });
});
