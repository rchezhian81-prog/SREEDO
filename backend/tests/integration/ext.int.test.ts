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

describe("external API (/ext) — API-key authenticated", () => {
  let inst: string;
  let adminTok: string;
  let apiKey: string;
  let keyId: string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function newApiKey(tok: string) {
    const res = await request(app)
      .post("/api/v1/integrations/api-keys")
      .set(auth(tok))
      .send({ name: "test" });
    expect(res.status).toBe(201);
    return res.body as { id: string; key: string };
  }

  beforeEach(async () => {
    await resetDb();
    inst = await createInstitution("EXT");
    await createUser({ email: "admin@ext.dev", password: PW, role: "admin", institutionId: inst });
    adminTok = await tokenFor("admin@ext.dev", PW);
    const k = await newApiKey(adminTok);
    apiKey = k.key;
    keyId = k.id;
    await query(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name)
       VALUES ($1, $2, 'Asha', 'Rao')`,
      [inst, "ADM-EXT-1"]
    );
  });

  it("rejects missing or invalid API keys", async () => {
    expect((await request(app).get("/api/v1/ext/me")).status).toBe(401);
    expect(
      (await request(app).get("/api/v1/ext/me").set("x-api-key", "sk_bogus_nope")).status
    ).toBe(401);
  });

  it("resolves /ext/me to the key's own institution", async () => {
    const res = await request(app).get("/api/v1/ext/me").set("x-api-key", apiKey);
    expect(res.status).toBe(200);
    expect(res.body.institution.id).toBe(inst);
    expect(res.body.institution.code).toBe("EXT");
  });

  it("stops working once the key is revoked", async () => {
    await request(app).post(`/api/v1/integrations/api-keys/${keyId}/revoke`).set(auth(adminTok));
    expect((await request(app).get("/api/v1/ext/me").set("x-api-key", apiKey)).status).toBe(401);
  });

  it("serves the key's own students and isolates other tenants", async () => {
    const res = await request(app).get("/api/v1/ext/students").set("x-api-key", apiKey);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].admissionNo).toBe("ADM-EXT-1");

    // A second tenant's key must never see the first tenant's students.
    const inst2 = await createInstitution("EXT2");
    await createUser({ email: "admin@ext2.dev", password: PW, role: "admin", institutionId: inst2 });
    const tok2 = await tokenFor("admin@ext2.dev", PW);
    const k2 = await newApiKey(tok2);
    const res2 = await request(app).get("/api/v1/ext/students").set("x-api-key", k2.key);
    expect(res2.status).toBe(200);
    expect(res2.body).toHaveLength(0);
  });

  it("bumps last_used_at when a key is used", async () => {
    await request(app).get("/api/v1/ext/me").set("x-api-key", apiKey);
    const { rows } = await query<{ last_used_at: string | null }>(
      "SELECT last_used_at FROM api_keys WHERE id = $1",
      [keyId]
    );
    expect(rows[0].last_used_at).not.toBeNull();
  });
});
