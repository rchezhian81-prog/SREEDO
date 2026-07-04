import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";
import { invalidatePermissionCache } from "../../src/middleware/permissions";

// Super Admin P — Platform Security & Compliance Center.

const PW = "Passw0rd!x";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const get = (p: string, t: string) => request(app).get(p).set(auth(t));
const post = (p: string, t: string, b?: unknown) => request(app).post(p).set(auth(t)).send(b ?? {});
const put = (p: string, t: string, b: unknown) => request(app).put(p).set(auth(t)).send(b);
const del = (p: string, t: string) => request(app).delete(p).set(auth(t));

const SECRET_RE = /totp_secret|password_hash|token_hash|refresh_token|"tokenHash"/i;
const noSecrets = (body: unknown) => expect(JSON.stringify(body)).not.toMatch(SECRET_RE);

describe("Super Admin P — Security Center", () => {
  const tok: Record<string, string> = {};
  const id: Record<string, string> = {};

  async function mkPlatform(email: string, platformRole: string | null): Promise<string> {
    const u = await createUser({ email, password: PW, role: "super_admin", institutionId: null });
    await query("UPDATE users SET platform_role = $2 WHERE id = $1", [u.id, platformRole]);
    return u.id;
  }

  beforeEach(async () => {
    await resetDb();
    // resetDb TRUNCATE users CASCADE also wipes rbac_roles + custom grants (FK to
    // users); re-seed the 6 built-in roles like the H suite does, and clear any
    // stray custom grants by denylist.
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
    id.owner = await mkPlatform("owner@p.dev", "owner");
    id.auditor = await mkPlatform("auditor@p.dev", "auditor");
    id.billing = await mkPlatform("billing@p.dev", "billing_admin");
    id.legacy = await mkPlatform("legacy@p.dev", null); // full-access, not an owner
    tok.owner = await tokenFor("owner@p.dev", PW);
    tok.auditor = await tokenFor("auditor@p.dev", PW);
    tok.billing = await tokenFor("billing@p.dev", PW);
    tok.legacy = await tokenFor("legacy@p.dev", PW);
  });

  // ---- A. Dashboard + RBAC gate ----
  it("dashboard summary + alerts load for owner; auditor is denied (403)", async () => {
    const s = await get("/api/v1/platform/security/summary", tok.owner);
    expect(s.status).toBe(200);
    expect(s.body).toHaveProperty("platformAdminsTotal");
    expect(s.body).toHaveProperty("platformAdminsWithout2fa");
    expect(s.body).toHaveProperty("activePlatformSessions");
    expect(s.body).toHaveProperty("failedLoginsToday");
    noSecrets(s.body);

    const a = await get("/api/v1/platform/security/alerts", tok.owner);
    expect(a.status).toBe(200);
    expect(Array.isArray(a.body)).toBe(true);
    // owner exists without 2FA → an owner_without_2fa alert should be present.
    expect(a.body.some((x: { key: string }) => x.key === "owner_without_2fa")).toBe(true);

    // auditor has no platform:security_read → 403 on the whole console.
    expect((await get("/api/v1/platform/security/summary", tok.auditor)).status).toBe(403);
    expect((await get("/api/v1/platform/security/sessions", tok.auditor)).status).toBe(403);
  });

  // ---- B. 2FA policy + compliance ----
  it("2FA policy get/update is audited; compliance list computes state; no secrets", async () => {
    const p0 = await get("/api/v1/platform/security/2fa/policy", tok.owner);
    expect(p0.status).toBe(200);
    expect(p0.body.roles.some((r: { roleKey: string }) => r.roleKey === "billing_admin")).toBe(true);

    const up = await put("/api/v1/platform/security/2fa/policy", tok.owner, {
      roleKey: "billing_admin",
      require2fa: true,
      graceUntil: "2020-01-01", // already elapsed → non-compliant now
      reason: "Enforce 2FA for billing role",
    });
    expect(up.status).toBe(200);
    expect(up.body.roles.find((r: { roleKey: string }) => r.roleKey === "billing_admin").require2fa).toBe(true);

    const comp = await get("/api/v1/platform/security/2fa/compliance?status=non_compliant", tok.owner);
    expect(comp.status).toBe(200);
    // billing@p.dev has no 2FA and its role now requires it (grace elapsed).
    expect(comp.body.rows.some((r: { email: string; state: string }) => r.email === "billing@p.dev" && r.state === "non_compliant")).toBe(true);
    noSecrets(comp.body);

    const aud = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM platform_audit_log WHERE action = 'security.2fa_policy_updated'"
    );
    expect(Number(aud.rows[0].n)).toBeGreaterThanOrEqual(1);
  });

  // ---- C. Sessions ----
  it("lists platform sessions, revokes one (reason required), revoke-all; never leaks tokens", async () => {
    const list = await get("/api/v1/platform/security/sessions", tok.owner);
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThan(0);
    noSecrets(list.body);
    const auditorSession = list.body.rows.find((r: { email: string }) => r.email === "auditor@p.dev");
    expect(auditorSession).toBeTruthy();

    // Reason required.
    expect((await post(`/api/v1/platform/security/sessions/${auditorSession.id}/revoke`, tok.owner, {})).status).toBe(400);

    const rev = await post(`/api/v1/platform/security/sessions/${auditorSession.id}/revoke`, tok.owner, {
      reason: "Investigating suspicious device",
    });
    expect(rev.status).toBe(200);
    expect(rev.body.revoked).toBe(1);

    const all = await post(`/api/v1/platform/security/users/${id.billing}/sessions/revoke-all`, tok.owner, {
      reason: "Force re-auth after policy change",
    });
    expect(all.status).toBe(200);
    expect(all.body.revoked).toBeGreaterThanOrEqual(0);

    // Backend enforced: revoked token is actually marked revoked.
    const chk = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM refresh_tokens WHERE id = $1 AND revoked_at IS NOT NULL",
      [auditorSession.id]
    );
    expect(Number(chk.rows[0].n)).toBe(1);
  });

  // ---- D. Login history + failed-login monitoring + export ----
  it("login history lists platform sign-ins, exports CSV (audited), and summarises failures", async () => {
    // Generate a few failed logins from a would-be attacker.
    for (let i = 0; i < 3; i++) {
      await request(app).post("/api/v1/auth/login").send({ email: "attacker@x.dev", password: "wrong" });
    }
    const hist = await get("/api/v1/platform/security/login-history?outcome=success", tok.owner);
    expect(hist.status).toBe(200);
    expect(hist.body.rows.every((r: { success: boolean }) => r.success === true)).toBe(true);
    expect(hist.body.rows.some((r: { actorEmail: string }) => r.actorEmail === "owner@p.dev")).toBe(true);

    const summ = await get("/api/v1/platform/security/login-history/summary?by=email&window=today", tok.owner);
    expect(summ.status).toBe(200);
    expect(summ.body.rows.some((r: { key: string; attempts: number }) => r.key === "attacker@x.dev" && r.attempts >= 3)).toBe(true);

    const exp = await get("/api/v1/platform/security/login-history/export?format=csv", tok.owner);
    expect(exp.status).toBe(200);
    expect(exp.headers["content-type"]).toMatch(/text\/csv/);
    expect(exp.text).not.toMatch(SECRET_RE);
    const aud = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM platform_audit_log WHERE action = 'security.login_history_exported'"
    );
    expect(Number(aud.rows[0].n)).toBe(1);
  });

  // ---- E. Locked accounts + lock/unlock + owner safety ----
  it("locks/unlocks with reason, lists locked accounts, and protects owner + self", async () => {
    const lock = await post(`/api/v1/platform/security/users/${id.auditor}/lock`, tok.owner, { reason: "Compromise suspected" });
    expect(lock.status).toBe(200);

    const locked = await get("/api/v1/platform/security/locked-accounts", tok.owner);
    expect(locked.status).toBe(200);
    expect(locked.body.some((r: { email: string; lockReason: string }) => r.email === "auditor@p.dev" && r.lockReason === "manual")).toBe(true);

    const unlock = await post(`/api/v1/platform/security/users/${id.auditor}/unlock`, tok.owner, { reason: "Cleared" });
    expect(unlock.status).toBe(200);

    // Cannot lock your own account.
    expect((await post(`/api/v1/platform/security/users/${id.owner}/lock`, tok.owner, { reason: "self test" })).status).toBe(400);
    // Cannot lock the last active owner (acting as a different full-access user).
    const lastOwner = await post(`/api/v1/platform/security/users/${id.owner}/lock`, tok.legacy, { reason: "last owner test" });
    expect(lastOwner.status).toBe(400);
    expect(lastOwner.body.error).toMatch(/last active owner/i);
  });

  // ---- F. Password policy ----
  it("returns a password-policy summary and updates the editable policy (audited)", async () => {
    const g = await get("/api/v1/platform/security/password-policy", tok.owner);
    expect(g.status).toBe(200);
    expect(g.body.enforced).toHaveProperty("lockout");
    expect(g.body.enforced.lockout).toHaveProperty("maxFailedAttempts");

    const u = await put("/api/v1/platform/security/password-policy", tok.owner, {
      minLength: 12,
      requireComplexity: true,
      expiryDays: 90,
      reason: "Tighten platform password policy",
    });
    expect(u.status).toBe(200);
    expect(u.body.minLength).toBe(12);
    expect(u.body.requireComplexity).toBe(true);
  });

  // ---- G. IP allowlist safety ----
  it("prevents enabling an allowlist that would lock the caller out", async () => {
    const st = await get("/api/v1/platform/security/ip-allowlist", tok.owner);
    expect(st.status).toBe(200);
    expect(st.body.enabled).toBe(false);
    const myIp = st.body.currentIp as string | null;

    // Enabling with only a foreign CIDR → refused.
    await post("/api/v1/platform/security/ip-allowlist", tok.owner, { cidr: "203.0.113.0/24", label: "office" });
    const bad = await put("/api/v1/platform/security/ip-allowlist/enabled", tok.owner, { enabled: true });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/lock/i);

    // Add the caller's own IP, then enabling succeeds.
    if (myIp) {
      await post("/api/v1/platform/security/ip-allowlist", tok.owner, { cidr: myIp, label: "me" });
      const ok = await put("/api/v1/platform/security/ip-allowlist/enabled", tok.owner, { enabled: true });
      expect(ok.status).toBe(200);
      expect(ok.body.enabled).toBe(true);
      // Turn it back off so it never affects later assertions in this test.
      await put("/api/v1/platform/security/ip-allowlist/enabled", tok.owner, { enabled: false });
    }
  });

  // ---- H. API tokens ----
  it("creates a token shown once (hash-only storage), lists masked, revokes and rotates", async () => {
    const created = await post("/api/v1/platform/security/api-tokens", tok.owner, {
      name: "CI integration",
      description: "read-only export",
      scopes: ["audit:read"],
    });
    expect(created.status).toBe(201);
    const raw = created.body.token as string;
    expect(raw).toMatch(/^gcp_/);

    // Stored as a SHA-256 hash of the raw token — never the plaintext.
    const row = await query<{ token_hash: string; token_prefix: string }>(
      "SELECT token_hash, token_prefix FROM platform_api_tokens WHERE id = $1",
      [created.body.id]
    );
    expect(row.rows[0].token_hash).toBe(crypto.createHash("sha256").update(raw).digest("hex"));
    expect(row.rows[0].token_hash).not.toBe(raw);

    // List never returns the token value.
    const list = await get("/api/v1/platform/security/api-tokens", tok.owner);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(raw);
    expect(list.body[0]).toHaveProperty("tokenPrefix");
    expect(list.body[0]).not.toHaveProperty("token");

    const rot = await post(`/api/v1/platform/security/api-tokens/${created.body.id}/rotate`, tok.owner, {});
    expect(rot.status).toBe(200);
    expect(rot.body.token).toMatch(/^gcp_/);
    expect(rot.body.token).not.toBe(raw);

    const rev = await post(`/api/v1/platform/security/api-tokens/${rot.body.id}/revoke`, tok.owner, {});
    expect(rev.status).toBe(200);
  });

  // ---- I. High-risk feed ----
  it("surfaces high-risk actions and exports them (audited)", async () => {
    // Produce a couple of high-risk events.
    await put("/api/v1/platform/security/2fa/policy", tok.owner, { roleKey: "auditor", require2fa: true });
    await post(`/api/v1/platform/security/users/${id.auditor}/lock`, tok.owner, { reason: "feed test" });

    const feed = await get("/api/v1/platform/security/high-risk", tok.owner);
    expect(feed.status).toBe(200);
    expect(feed.body.total).toBeGreaterThan(0);
    expect(feed.body.rows.some((r: { action: string }) => r.action.startsWith("security.") || r.action.startsWith("platform.admin."))).toBe(true);

    const exp = await get("/api/v1/platform/security/high-risk/export?format=csv", tok.owner);
    expect(exp.status).toBe(200);
    expect(exp.headers["content-type"]).toMatch(/text\/csv/);
    const aud = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM platform_audit_log WHERE action = 'security.high_risk_exported'"
    );
    expect(Number(aud.rows[0].n)).toBe(1);
  });

  // ---- J. Compliance reports ----
  it("runs compliance reports and exports one (audited, reason accepted)", async () => {
    const access = await get("/api/v1/platform/security/reports?report=platform_admin_access", tok.owner);
    expect(access.status).toBe(200);
    expect(access.body.columns.length).toBeGreaterThan(0);
    expect(access.body.rows.some((r: { email: string }) => r.email === "owner@p.dev")).toBe(true);
    noSecrets(access.body);

    const twofa = await get("/api/v1/platform/security/reports?report=twofa_compliance", tok.owner);
    expect(twofa.status).toBe(200);

    const exp = await get(
      "/api/v1/platform/security/reports/export?report=platform_admin_access&format=csv&reason=quarterly%20audit",
      tok.owner
    );
    expect(exp.status).toBe(200);
    expect(exp.headers["content-type"]).toMatch(/text\/csv/);
    expect(exp.text).not.toMatch(SECRET_RE);
    const aud = await query<{ n: number; reason: string | null }>(
      "SELECT count(*)::int AS n, max(detail->>'reason') AS reason FROM platform_audit_log WHERE action = 'security.report_exported'"
    );
    expect(Number(aud.rows[0].n)).toBe(1);
    expect(aud.rows[0].reason).toMatch(/quarterly/);
  });

  // ---- RBAC granular enforcement (H integration) ----
  it("a sub-role granted only security_read can view but not manage (403)", async () => {
    // Grant read-only Security Center access to a custom role via the H model.
    await query("INSERT INTO rbac_roles (key, name, kind) VALUES ('sec_read','Security Reader','custom') ON CONFLICT DO NOTHING");
    await query(
      `INSERT INTO role_permissions (role, permission_id)
       SELECT 'sec_read', id FROM permissions WHERE key = 'platform:security_read' ON CONFLICT DO NOTHING`
    );
    // The RBAC API busts this cache on save; we granted via raw SQL, so do it here.
    invalidatePermissionCache();
    await mkPlatform("secread@p.dev", "sec_read");
    const t = await tokenFor("secread@p.dev", PW);

    expect((await get("/api/v1/platform/security/summary", t)).status).toBe(200);
    expect((await get("/api/v1/platform/security/sessions", t)).status).toBe(200);
    // No security_manage → mutations denied.
    expect((await put("/api/v1/platform/security/2fa/policy", t, { roleKey: "auditor", require2fa: true })).status).toBe(403);
    expect((await post("/api/v1/platform/security/api-tokens", t, { name: "x", scopes: [] })).status).toBe(403);
  });

  // ---- Regression sanity: adjacent modules still answer for owner ----
  it("does not break auth/login, Platform Admin Users, RBAC, packages", async () => {
    expect((await get("/api/v1/auth/me", tok.owner)).status).toBe(200);
    expect((await get("/api/v1/platform/admins", tok.owner)).status).toBe(200);
    expect((await get("/api/v1/platform/rbac/roles", tok.owner)).status).toBe(200);
    expect((await get("/api/v1/packages", tok.owner)).status).toBe(200);
    expect((await get("/api/v1/platform/subscriptions", tok.owner)).status).toBe(200);
    // Login still issues tokens.
    const relog = await request(app).post("/api/v1/auth/login").send({ email: "owner@p.dev", password: PW });
    expect(relog.status).toBe(200);
    expect(relog.body).toHaveProperty("accessToken");
  });
});
