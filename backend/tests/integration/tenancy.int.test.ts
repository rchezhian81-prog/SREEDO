import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

// Foundation for institution_id scoping: the tenant context is carried in the
// access token and surfaced on /auth/me. (Per-module query scoping lands next.)
describe("tenant context", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("carries the user's institution through login to /auth/me", async () => {
    const institutionId = await createInstitution("ACME");
    await createUser({
      email: "admin@acme.dev",
      password: "Passw0rd!",
      role: "admin",
      institutionId,
    });

    const token = await tokenFor("admin@acme.dev", "Passw0rd!");
    const me = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(me.status).toBe(200);
    expect(me.body.institutionId).toBe(institutionId);
  });

  it("reports a null institution for a super admin", async () => {
    await createUser({
      email: "super@acme.dev",
      password: "Passw0rd!",
      role: "super_admin",
    });
    const token = await tokenFor("super@acme.dev", "Passw0rd!");
    const me = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(me.status).toBe(200);
    expect(me.body.institutionId).toBeNull();
  });
});
