import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";

/**
 * The institution activity log (GAP-X05): a read-only audit view scoped to the
 * caller's own institution. Auth boundaries are asserted here; the row-level
 * Mongo query is shared with (and exercised by) the admin-console viewer.
 */
describe("institution activity log (/activity)", () => {
  let instA: string;
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("ACT");
    await createUser({
      email: "admin@act.dev",
      password: PW,
      role: "admin",
      institutionId: instA,
    });
    await createUser({
      email: "super@act.dev",
      password: PW,
      role: "super_admin",
      institutionId: null,
    });
    tok.admin = await tokenFor("admin@act.dev", PW);
    tok.super = await tokenFor("super@act.dev", PW);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/activity");
    expect(res.status).toBe(401);
  });

  it("is institution-admin only (super admin uses the global console)", async () => {
    const res = await request(app)
      .get("/api/v1/activity")
      .set(auth(tok.super));
    expect(res.status).toBe(403);
  });

  it("lets an institution admin read the log (degrades gracefully without Mongo)", async () => {
    const res = await request(app)
      .get("/api/v1/activity")
      .set(auth(tok.admin));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("available");
    expect(Array.isArray(res.body.rows)).toBe(true);
  });

  it("rejects an out-of-range limit", async () => {
    const res = await request(app)
      .get("/api/v1/activity?limit=9999")
      .set(auth(tok.admin));
    expect(res.status).toBe(400);
  });
});
