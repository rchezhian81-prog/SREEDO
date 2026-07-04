import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";
import { signAccessToken } from "../../src/utils/jwt";
import { generateTotp } from "../../src/utils/totp";

// Super Admin P — Phase 2 hardening: per-request session revocation, the 2FA
// hard-block-with-owner-recovery login gate, and the governed platform API-token
// surface. See src/middleware/auth.ts, src/modules/auth/auth.service.ts,
// src/middleware/platform-token.ts, src/modules/platform/platform-ext.routes.ts.

const PW = "Passw0rd!x";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const get = (p: string, t: string) => request(app).get(p).set(auth(t));
const post = (p: string, t: string, b?: unknown) =>
  request(app).post(p).set(auth(t)).send(b ?? {});
const login = (email: string, password: string, totpCode?: string) =>
  request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, ...(totpCode ? { totpCode } : {}) });

describe("Super Admin P — Phase 2 hardening", () => {
  async function mkPlatform(email: string, platformRole: string | null): Promise<string> {
    const u = await createUser({ email, password: PW, role: "super_admin", institutionId: null });
    await query("UPDATE users SET platform_role = $2 WHERE id = $1", [u.id, platformRole]);
    return u.id;
  }

  beforeEach(async () => {
    await resetDb();
    // resetDb TRUNCATE users CASCADE also wipes rbac_roles + custom grants (FK to
    // users); re-seed the 6 built-in roles like the P/H suites do.
    await query(
      `DELETE FROM role_permissions WHERE role NOT IN
        ('admin','teacher','accountant','student','parent','super_admin',
         'owner','platform_admin','support_operator','billing_admin','auditor','technical_admin')`
    );
    await query(
      `INSERT INTO rbac_roles (key, name, kind, is_owner, is_system) VALUES
        ('owner','Owner / Super Admin','built_in',true,true),
        ('platform_admin','Platform Admin','built_in',false,true),
        ('support_operator','Support Operator','built_in',false,true),
        ('billing_admin','Billing Admin','built_in',false,true),
        ('auditor','Read-only Auditor','built_in',false,true),
        ('technical_admin','Technical Admin','built_in',false,true)
       ON CONFLICT (key) DO NOTHING`
    );
  });

  // ---- 1. Per-request session revocation (soft revoke) ----
  it("rejects a soft-revoked session's access token immediately (401)", async () => {
    const inst = await createInstitution("REV1");
    const u = await createUser({ email: "rev1@t.dev", password: PW, role: "admin", institutionId: inst });
    const token = await tokenFor("rev1@t.dev", PW);

    expect((await get("/api/v1/auth/permissions", token)).status).toBe(200);

    await query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1", [u.id]);

    const after = await get("/api/v1/auth/permissions", token);
    expect(after.status).toBe(401);
  });

  // ---- 2. Session absent (deleted row) ----
  it("rejects the same access token once its session row is deleted (401)", async () => {
    const inst = await createInstitution("REV2");
    const u = await createUser({ email: "rev2@t.dev", password: PW, role: "admin", institutionId: inst });
    const token = await tokenFor("rev2@t.dev", PW);

    expect((await get("/api/v1/auth/permissions", token)).status).toBe(200);

    await query("DELETE FROM refresh_tokens WHERE user_id = $1", [u.id]);

    expect((await get("/api/v1/auth/permissions", token)).status).toBe(401);
  });

  // ---- 3. Legacy token without a sid is still accepted (backward-compatible) ----
  it("accepts a legacy access token that carries no session id (sid)", async () => {
    const inst = await createInstitution("LEG3");
    const u = await createUser({ email: "legacy3@t.dev", password: PW, role: "admin", institutionId: inst });
    // Mint a token the pre-session-id way: no sid claim at all.
    const legacy = signAccessToken({
      sub: u.id,
      email: "legacy3@t.dev",
      role: "admin",
      institutionId: inst,
    });
    const res = await get("/api/v1/auth/permissions", legacy);
    expect(res.status).toBe(200);
  });

  // ---- 4. 2FA hard-block → scoped setup session → enroll → full login ----
  it("hard-blocks a non-compliant platform role with a scoped setup session, then lets it enroll", async () => {
    await mkPlatform("billing4@p.dev", "billing_admin");
    // billing_admin must have 2FA; grace already elapsed → non-compliant now.
    await query(
      `INSERT INTO security_2fa_policy (role_key, require_2fa, grace_until)
       VALUES ('billing_admin', true, '2020-01-01')
       ON CONFLICT (role_key) DO UPDATE SET require_2fa = true, grace_until = '2020-01-01'`
    );

    const res = await login("billing4@p.dev", PW);
    expect(res.status).toBe(200);
    expect(res.body.twoFactorSetupRequired).toBe(true);
    expect(typeof res.body.setupToken).toBe("string");
    expect(res.body).not.toHaveProperty("accessToken");
    expect(res.body).not.toHaveProperty("refreshToken");
    const setup = res.body.setupToken as string;

    // The setup session reaches ONLY the enrollment surface...
    expect((await get("/api/v1/auth/2fa/status", setup)).status).toBe(200);
    const begin = await post("/api/v1/auth/2fa/setup", setup);
    expect(begin.status).toBe(200);
    const secret = begin.body.secret as string;
    expect(typeof secret).toBe("string");
    // ...but is 403'd on any normal route.
    expect((await get("/api/v1/platform/security/summary", setup)).status).toBe(403);

    // A setup event was recorded on login.
    const evt = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM platform_audit_log WHERE action = 'auth.2fa.setup_required'"
    );
    expect(Number(evt.rows[0].n)).toBeGreaterThanOrEqual(1);

    // Enroll (confirm a computed TOTP).
    const enable = await post("/api/v1/auth/2fa/enable", setup, { code: generateTotp(secret) });
    expect(enable.status).toBe(204);

    // Now a normal login (with a fresh TOTP) yields a FULL session.
    const full = await login("billing4@p.dev", PW, generateTotp(secret));
    expect(full.status).toBe(200);
    expect(typeof full.body.accessToken).toBe("string");
    expect(full.body.twoFactorSetupRequired).toBeUndefined();
  });

  // ---- 5. Owner is never blocked (absolute lockout guard) ----
  it("never blocks the sole active owner, even under force_2fa + an elapsed owner policy", async () => {
    await mkPlatform("owner5@p.dev", "owner");
    await query(
      `INSERT INTO platform_security_config (id, force_2fa_for_platform)
       VALUES (TRUE, true)
       ON CONFLICT (id) DO UPDATE SET force_2fa_for_platform = true`
    );
    await query(
      `INSERT INTO security_2fa_policy (role_key, require_2fa, grace_until)
       VALUES ('owner', true, '2020-01-01')
       ON CONFLICT (role_key) DO UPDATE SET require_2fa = true, grace_until = '2020-01-01'`
    );

    const res = await login("owner5@p.dev", PW);
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe("string");
    expect(res.body.twoFactorSetupRequired).toBeUndefined();
  });

  // ---- 6. Tenant users are never subject to the platform 2FA hard-block ----
  it("does not hard-block tenant users even when force_2fa is on", async () => {
    const inst = await createInstitution("TEN6");
    await createUser({ email: "admin6@t.dev", password: PW, role: "admin", institutionId: inst });
    await query(
      `INSERT INTO platform_security_config (id, force_2fa_for_platform)
       VALUES (TRUE, true)
       ON CONFLICT (id) DO UPDATE SET force_2fa_for_platform = true`
    );

    const res = await login("admin6@t.dev", PW);
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe("string");
    expect(res.body.twoFactorSetupRequired).toBeUndefined();
  });

  // ---- 7. Governed API-token surface (/platform/ext) ----
  it("governs /platform/ext with a scoped X-Platform-Token (scope-checked, revocable, stamps last_used_at)", async () => {
    await mkPlatform("owner7@p.dev", "owner");
    const ownerTok = await tokenFor("owner7@p.dev", PW);

    // Create a platform:read token (full value shown once).
    const created = await post("/api/v1/platform/security/api-tokens", ownerTok, {
      name: "ext-reader",
      scopes: ["platform:read"],
    });
    expect(created.status).toBe(201);
    const raw = created.body.token as string;
    expect(raw).toMatch(/^gcp_/);

    // Correct token + scope → 200; never echoes the token.
    const ok = await request(app).get("/api/v1/platform/ext/summary").set("X-Platform-Token", raw);
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveProperty("totalInstitutions");
    expect(JSON.stringify(ok.body)).not.toContain(raw);

    // last_used_at got stamped on success.
    const used = await query<{ last_used_at: Date | null }>(
      "SELECT last_used_at FROM platform_api_tokens WHERE id = $1",
      [created.body.id]
    );
    expect(used.rows[0].last_used_at).not.toBeNull();

    // Absent token → 401; unknown token → 401.
    expect((await request(app).get("/api/v1/platform/ext/summary")).status).toBe(401);
    expect(
      (await request(app).get("/api/v1/platform/ext/summary").set("X-Platform-Token", "gcp_nope")).status
    ).toBe(401);

    // A valid token that lacks platform:read → 403.
    const metricsOnly = await post("/api/v1/platform/security/api-tokens", ownerTok, {
      name: "metrics-only",
      scopes: ["metrics:read"],
    });
    expect(metricsOnly.status).toBe(201);
    expect(
      (await request(app)
        .get("/api/v1/platform/ext/summary")
        .set("X-Platform-Token", metricsOnly.body.token as string)).status
    ).toBe(403);

    // Revoke the platform:read token → now 401.
    const rev = await post(`/api/v1/platform/security/api-tokens/${created.body.id}/revoke`, ownerTok);
    expect(rev.status).toBe(200);
    expect(
      (await request(app).get("/api/v1/platform/ext/summary").set("X-Platform-Token", raw)).status
    ).toBe(401);
  });

  // ---- 8. Default (no policy) — login still yields full tokens ----
  it("issues full tokens on a normal login when no 2FA policy is configured", async () => {
    await mkPlatform("padmin8@p.dev", "platform_admin");
    const inst = await createInstitution("TEN8");
    await createUser({ email: "admin8@t.dev", password: PW, role: "admin", institutionId: inst });

    const p = await login("padmin8@p.dev", PW);
    expect(p.status).toBe(200);
    expect(typeof p.body.accessToken).toBe("string");
    expect(p.body.twoFactorSetupRequired).toBeUndefined();

    const t = await login("admin8@t.dev", PW);
    expect(t.status).toBe(200);
    expect(typeof t.body.accessToken).toBe("string");
    expect(t.body.twoFactorSetupRequired).toBeUndefined();
  });
});
