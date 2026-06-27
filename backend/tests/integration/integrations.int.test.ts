import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";

describe("integrations: API keys & webhooks (/integrations)", () => {
  let instA: string;
  let instB: string;
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("INT");
    instB = await createInstitution("INT2");
    await createUser({ email: "admin@int.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "admin@int2.dev", password: PW, role: "admin", institutionId: instB });
    await createUser({ email: "super@int.dev", password: PW, role: "super_admin", institutionId: null });
    tok.admin = await tokenFor("admin@int.dev", PW);
    tok.adminB = await tokenFor("admin@int2.dev", PW);
    tok.super = await tokenFor("super@int.dev", PW);
  });

  it("requires auth + tenant + admin role", async () => {
    expect((await request(app).get("/api/v1/integrations/api-keys")).status).toBe(401);
    expect((await request(app).get("/api/v1/integrations/api-keys").set(auth(tok.super))).status).toBe(403);
  });

  it("creates an API key (shown once), lists it masked, revokes and deletes", async () => {
    const created = await request(app)
      .post("/api/v1/integrations/api-keys")
      .set(auth(tok.admin))
      .send({ name: "Zapier" });
    expect(created.status).toBe(201);
    expect(created.body.key).toMatch(/^sk_[0-9a-f]+_[0-9a-f]+$/);
    const id = created.body.id as string;

    const list = await request(app).get("/api/v1/integrations/api-keys").set(auth(tok.admin));
    expect(list.body).toHaveLength(1);
    // The secret is never returned again — only the prefix.
    expect(list.body[0].key).toBeUndefined();
    expect(list.body[0].keyPrefix).toBe(created.body.keyPrefix);
    expect(list.body[0].isActive).toBe(true);

    const revoked = await request(app)
      .post(`/api/v1/integrations/api-keys/${id}/revoke`)
      .set(auth(tok.admin));
    expect(revoked.body.isActive).toBe(false);

    expect(
      (await request(app).delete(`/api/v1/integrations/api-keys/${id}`).set(auth(tok.admin))).status
    ).toBe(204);
  });

  it("registers, updates and deletes webhook endpoints", async () => {
    const created = await request(app)
      .post("/api/v1/integrations/webhooks")
      .set(auth(tok.admin))
      .send({ url: "https://example.com/hook", eventTypes: "student.created" });
    expect(created.status).toBe(201);
    expect(created.body.isActive).toBe(true);
    const id = created.body.id as string;

    // Invalid URL rejected.
    expect(
      (await request(app).post("/api/v1/integrations/webhooks").set(auth(tok.admin)).send({ url: "not-a-url" })).status
    ).toBe(400);

    const upd = await request(app)
      .patch(`/api/v1/integrations/webhooks/${id}`)
      .set(auth(tok.admin))
      .send({ isActive: false });
    expect(upd.body.isActive).toBe(false);

    expect(
      (await request(app).delete(`/api/v1/integrations/webhooks/${id}`).set(auth(tok.admin))).status
    ).toBe(204);
  });

  it("isolates tenants", async () => {
    await request(app).post("/api/v1/integrations/api-keys").set(auth(tok.admin)).send({ name: "A" });
    const listB = await request(app).get("/api/v1/integrations/api-keys").set(auth(tok.adminB));
    expect(listB.body).toHaveLength(0);
  });
});
