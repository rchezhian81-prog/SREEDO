import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";
import { env } from "../../src/config/env";
import {
  assertInstitutionActive,
  invalidateInstitutionStatusCache,
} from "../../src/middleware/institution-status";

// PR-SEC2 — tenant suspension enforcement. Proves: with ENFORCE_TENANT_SUSPENSION
// on, a suspended/inactive institution's users are blocked at login and on every
// request (clear INSTITUTION_SUSPENDED code, audited); super_admin and audited
// support-impersonation sessions are exempt; the kill-switch disables it; and
// reactivation restores access. The flag is OFF by default, so this suite turns it
// on explicitly (mirrors PR-SEC1's ENFORCE_TEACHER_SCOPE test).

const PW = "Passw0rd!";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const login = (email: string) =>
  request(app).post("/api/v1/auth/login").send({ email, password: PW });

async function setActive(instId: string, active: boolean): Promise<void> {
  await query("UPDATE institutions SET is_active = $2, status = $3 WHERE id = $1", [
    instId,
    active,
    active ? "active" : "suspended",
  ]);
  invalidateInstitutionStatusCache(instId);
}

describe("tenant suspension enforcement (PR-SEC2)", () => {
  let inst: string;
  let adminId: string;

  beforeEach(async () => {
    await resetDb();
    env.enforceTenantSuspension = true; // OFF by default — enable for this suite
    invalidateInstitutionStatusCache();
    inst = await createInstitution("SUS");
    const admin = await createUser({ email: "admin@sus.dev", password: PW, role: "admin", institutionId: inst });
    adminId = admin.id;
    await createUser({ email: "parent@sus.dev", password: PW, role: "parent", institutionId: inst });
    await createUser({ email: "super@sus.dev", password: PW, role: "super_admin", institutionId: null });
  });

  afterAll(() => {
    env.enforceTenantSuspension = false; // restore the default for other suites
  });

  it("active tenant: login and requests succeed", async () => {
    const tok = await tokenFor("admin@sus.dev", PW);
    expect((await request(app).get("/api/v1/auth/me").set(auth(tok))).status).toBe(200);
  });

  it("suspended tenant: login is blocked with INSTITUTION_SUSPENDED (audited)", async () => {
    await setActive(inst, false);
    const res = await login("admin@sus.dev");
    expect(res.status).toBe(403);
    expect(res.body.details?.code).toBe("INSTITUTION_SUSPENDED");
    const { rows } = await query(
      "SELECT 1 FROM platform_audit_log WHERE institution_id = $1 AND action = 'tenant.suspension.login_blocked'",
      [inst]
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("suspended tenant: an existing session is blocked on the next request (audited)", async () => {
    const tok = await tokenFor("admin@sus.dev", PW); // signed in while active
    expect((await request(app).get("/api/v1/auth/me").set(auth(tok))).status).toBe(200);
    await setActive(inst, false);
    const res = await request(app).get("/api/v1/auth/me").set(auth(tok));
    expect(res.status).toBe(403);
    expect(res.body.details?.code).toBe("INSTITUTION_SUSPENDED");
    const { rows } = await query(
      "SELECT 1 FROM platform_audit_log WHERE institution_id = $1 AND action = 'tenant.suspension.access_blocked'",
      [inst]
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("portal user of a suspended tenant is blocked at login", async () => {
    await setActive(inst, false);
    const res = await login("parent@sus.dev");
    expect(res.status).toBe(403);
    expect(res.body.details?.code).toBe("INSTITUTION_SUSPENDED");
  });

  it("super_admin is unaffected by tenant suspension", async () => {
    await setActive(inst, false);
    const res = await login("super@sus.dev"); // no institution → not gated
    expect(res.status).toBe(200);
    expect((await request(app).get("/api/v1/auth/me").set(auth(res.body.accessToken))).status).toBe(200);
  });

  it("audited platform-support impersonation bypasses suspension", async () => {
    await setActive(inst, false);
    // Unit-level: the guard's support branch (req.support set only for an audited
    // impersonation session) allows the request and records the bypass. The HTTP
    // support path additionally goes through enforceSupportScope (tested elsewhere).
    const req = {
      user: { id: adminId, email: "admin@sus.dev", role: "admin", institutionId: inst, sessionId: "sess-1" },
      support: { sid: "imp-1", actorId: "op-1", scope: "read_only" },
      ip: "127.0.0.1",
      path: "/auth/me",
    } as unknown as Parameters<typeof assertInstitutionActive>[0];
    await expect(assertInstitutionActive(req)).resolves.toBeUndefined(); // no throw → bypass
    const { rows } = await query(
      "SELECT 1 FROM platform_audit_log WHERE institution_id = $1 AND action = 'tenant.suspension.support_bypass'",
      [inst]
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("normal user (no support) of a suspended tenant is thrown at the guard", async () => {
    await setActive(inst, false);
    const req = {
      user: { id: adminId, email: "admin@sus.dev", role: "admin", institutionId: inst, sessionId: "sess-2" },
      support: null,
      ip: "127.0.0.1",
      path: "/students",
    } as unknown as Parameters<typeof assertInstitutionActive>[0];
    await expect(assertInstitutionActive(req)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("kill-switch OFF: suspension is not enforced", async () => {
    env.enforceTenantSuspension = false;
    invalidateInstitutionStatusCache();
    await setActive(inst, false);
    expect((await login("admin@sus.dev")).status).toBe(200); // no enforcement
    env.enforceTenantSuspension = true;
  });

  it("reactivating a suspended tenant restores access", async () => {
    await setActive(inst, false);
    expect((await login("admin@sus.dev")).status).toBe(403);
    await setActive(inst, true);
    expect((await login("admin@sus.dev")).status).toBe(200);
  });
});
