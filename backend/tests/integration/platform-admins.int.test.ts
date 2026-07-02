import crypto from "node:crypto";
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

// Super Admin I — Platform Admin User Management & Security Controls.

const PW = "Passw0rd!x";

describe("Super Admin I — platform admin management", () => {
  const tok: Record<string, string> = {};
  const id: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, b?: unknown) => request(app).post(p).set(auth(t)).send(b ?? {});
  const patch = (p: string, t: string, b: unknown) => request(app).patch(p).set(auth(t)).send(b);
  const del = (p: string, t: string) => request(app).delete(p).set(auth(t));

  async function mkPlatform(email: string, platformRole: string, active = true): Promise<string> {
    const u = await createUser({ email, password: PW, role: "super_admin", institutionId: null });
    await query("UPDATE users SET platform_role = $2, is_active = $3 WHERE id = $1", [u.id, platformRole, active]);
    return u.id;
  }

  beforeEach(async () => {
    await resetDb();
    id.owner = await mkPlatform("owner@i.dev", "owner");
    id.padmin = await mkPlatform("padmin@i.dev", "platform_admin");
    // A tenant admin that must NEVER appear in / be managed by this console.
    const inst = await createInstitution("IIN");
    await createUser({ email: "tadmin@i.dev", password: PW, role: "admin", institutionId: inst });
    tok.owner = await tokenFor("owner@i.dev", PW);
    tok.tadmin = await tokenFor("tadmin@i.dev", PW);
  });

  it("lists only platform users, never tenant users, and leaks no secrets", async () => {
    const res = await get("/api/v1/platform/admins", tok.owner);
    expect(res.status).toBe(200);
    const emails = res.body.rows.map((r: { email: string }) => r.email);
    expect(emails).toContain("owner@i.dev");
    expect(emails).toContain("padmin@i.dev");
    expect(emails).not.toContain("tadmin@i.dev");
    const blob = JSON.stringify(res.body);
    expect(blob).not.toMatch(/password_hash|passwordHash|totp_secret|totpSecret/);
  });

  it("summarises counts", async () => {
    const res = await get("/api/v1/platform/admins/summary", tok.owner);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.owners).toBe(1);
    expect(res.body.active).toBe(2);
  });

  it("invites, lists, resends and cancels a platform admin", async () => {
    const inv = await post("/api/v1/platform/admins/invites", tok.owner, {
      email: "new@i.dev",
      platformRole: "billing_admin",
    });
    expect(inv.status).toBe(201);
    expect(inv.body.emailSent).toBe(false); // SMTP unset → degrades, no throw

    let list = await get("/api/v1/platform/admins/invites", tok.owner);
    expect(list.body.some((i: { email: string; status: string }) => i.email === "new@i.dev" && i.status === "pending")).toBe(true);

    expect((await post(`/api/v1/platform/admins/invites/${inv.body.id}/resend`, tok.owner)).status).toBe(200);
    expect((await post(`/api/v1/platform/admins/invites/${inv.body.id}/cancel`, tok.owner)).status).toBe(204);

    list = await get("/api/v1/platform/admins/invites", tok.owner);
    expect(list.body.find((i: { id: string }) => i.id === inv.body.id).status).toBe("cancelled");

    // Duplicate: inviting an existing user's email is rejected.
    expect((await post("/api/v1/platform/admins/invites", tok.owner, { email: "owner@i.dev", platformRole: "auditor" })).status).toBe(409);
  });

  it("accepts an invite (public) and creates a working platform admin", async () => {
    const raw = "invite-token-abcdef-0123456789";
    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    await query(
      `INSERT INTO platform_invites (email, platform_role, token_hash, status, expires_at)
       VALUES ($1, 'support_operator', $2, 'pending', now() + interval '2 days')`,
      ["support@i.dev", hash]
    );
    const acc = await request(app).post("/api/v1/platform/invite/accept").send({
      token: raw, fullName: "Support Person", password: "Passw0rd!yy",
    });
    expect(acc.status).toBe(200);
    // The new user can log in and is a platform admin.
    const t = await tokenFor("support@i.dev", "Passw0rd!yy");
    const me = await get("/api/v1/auth/me", t);
    expect(me.body.role).toBe("super_admin");
    const list = await get("/api/v1/platform/admins", tok.owner);
    expect(list.body.rows.find((r: { email: string; platformRole: string }) => r.email === "support@i.dev").platformRole).toBe("support_operator");
    // Re-accepting the same (now used) token fails.
    expect((await request(app).post("/api/v1/platform/invite/accept").send({ token: raw, fullName: "x", password: "Passw0rd!zz" })).status).toBe(400);
  });

  it("enables/disables with a required reason, revokes sessions, and audits", async () => {
    // Reason required.
    expect((await patch(`/api/v1/platform/admins/${id.padmin}/active`, tok.owner, { isActive: false })).status).toBe(400);
    // padmin has a live session; disabling revokes it.
    await request(app).post("/api/v1/auth/login").set("User-Agent", "vitest").send({ email: "padmin@i.dev", password: PW });
    const dis = await patch(`/api/v1/platform/admins/${id.padmin}/active`, tok.owner, { isActive: false, reason: "offboarding contractor" });
    expect(dis.status).toBe(200);
    expect(dis.body.isActive).toBe(false);
    const disabledSessions = await get(`/api/v1/platform/admins/${id.padmin}/sessions`, tok.owner);
    expect(disabledSessions.body).toHaveLength(0);
    // Re-enable.
    expect((await patch(`/api/v1/platform/admins/${id.padmin}/active`, tok.owner, { isActive: true, reason: "returned" })).body.isActive).toBe(true);
    // Audit rows exist.
    const audit = await get("/api/v1/platform/audit?action=platform.admin.disabled", tok.owner);
    expect(audit.body.rows.length).toBeGreaterThan(0);
  });

  it("protects the last owner and self", async () => {
    // Only one owner → cannot disable, lock, or demote it.
    expect((await patch(`/api/v1/platform/admins/${id.owner}/active`, tok.owner, { isActive: false, reason: "should fail" })).status).toBe(400);
    expect((await post(`/api/v1/platform/admins/${id.owner}/lock`, tok.owner, { reason: "should fail here" })).status).toBe(400);
    expect((await post(`/api/v1/platform/admins/${id.owner}/role`, tok.owner, { platformRole: "auditor", reason: "should fail too" })).status).toBe(400);
    // Add a 2nd owner → now the first owner can be demoted, but still not self-disabled.
    const owner2 = await mkPlatform("owner2@i.dev", "owner");
    expect((await post(`/api/v1/platform/admins/${owner2}/role`, tok.owner, { platformRole: "platform_admin", reason: "demote spare owner" })).status).toBe(200);
    // owner disabling itself is blocked (self guard).
    expect((await patch(`/api/v1/platform/admins/${id.owner}/active`, tok.owner, { isActive: false, reason: "no self disable" })).status).toBe(400);
  });

  it("locks, unlocks, assigns role and resets 2FA (reason required, audited)", async () => {
    // reason required on lock
    expect((await post(`/api/v1/platform/admins/${id.padmin}/lock`, tok.owner, {})).status).toBe(400);
    expect((await post(`/api/v1/platform/admins/${id.padmin}/lock`, tok.owner, { reason: "suspicious activity" })).body.locked).toBe(true);
    expect((await post(`/api/v1/platform/admins/${id.padmin}/unlock`, tok.owner, { reason: "cleared with user" })).body.locked).toBe(false);
    expect((await post(`/api/v1/platform/admins/${id.padmin}/role`, tok.owner, { platformRole: "auditor", reason: "moved to audit team" })).body.platformRole).toBe("auditor");
    // 2FA reset
    await query("UPDATE users SET totp_enabled = true, totp_secret = 'x' WHERE id = $1", [id.padmin]);
    const r = await post(`/api/v1/platform/admins/${id.padmin}/reset-2fa`, tok.owner, { reason: "user lost device" });
    expect(r.body.twoFactorEnabled).toBe(false);
  });

  it("lists and revokes sessions", async () => {
    await request(app).post("/api/v1/auth/login").set("User-Agent", "browser-A").send({ email: "padmin@i.dev", password: PW });
    await request(app).post("/api/v1/auth/login").set("User-Agent", "browser-B").send({ email: "padmin@i.dev", password: PW });
    let sessions = await get(`/api/v1/platform/admins/${id.padmin}/sessions`, tok.owner);
    expect(sessions.body.length).toBe(2);
    expect(sessions.body[0]).toHaveProperty("userAgent");
    // revoke one
    expect((await del(`/api/v1/platform/admins/${id.padmin}/sessions/${sessions.body[0].id}`, tok.owner)).status).toBe(204);
    sessions = await get(`/api/v1/platform/admins/${id.padmin}/sessions`, tok.owner);
    expect(sessions.body.length).toBe(1);
    // revoke all
    expect((await post(`/api/v1/platform/admins/${id.padmin}/sessions/revoke-all`, tok.owner)).body.revoked).toBe(1);
    expect((await get(`/api/v1/platform/admins/${id.padmin}/sessions`, tok.owner)).body).toHaveLength(0);
  });

  it("shows login history (successful + failed) with IP/device", async () => {
    await request(app).post("/api/v1/auth/login").set("User-Agent", "hist-browser").send({ email: "padmin@i.dev", password: PW });
    await request(app).post("/api/v1/auth/login").send({ email: "padmin@i.dev", password: "wrong" });
    const all = await get("/api/v1/platform/admins/login-history?q=padmin@i.dev", tok.owner);
    expect(all.body.total).toBeGreaterThanOrEqual(2);
    const succ = await get("/api/v1/platform/admins/login-history?outcome=success&q=padmin@i.dev", tok.owner);
    expect(succ.body.rows.every((r: { success: boolean }) => r.success)).toBe(true);
    const failed = await get("/api/v1/platform/admins/login-history?outcome=failed&q=padmin@i.dev", tok.owner);
    expect(failed.body.rows.length).toBeGreaterThan(0);
    expect(failed.body.rows[0].success).toBe(false);
  });

  it("reads and updates the platform security policy", async () => {
    expect((await get("/api/v1/platform/admins/security-config", tok.owner)).body.force2faForPlatform).toBe(false);
    const upd = await request(app).put("/api/v1/platform/admins/security-config").set(auth(tok.owner)).send({ force2faForPlatform: true, reason: "hardening the team" });
    expect(upd.status).toBe(200);
    expect(upd.body.force2faForPlatform).toBe(true);
  });

  it("denies the entire console to non-super-admins", async () => {
    expect((await get("/api/v1/platform/admins", tok.tadmin)).status).toBe(403);
    expect((await get("/api/v1/platform/admins/summary", tok.tadmin)).status).toBe(403);
    expect((await post("/api/v1/platform/admins/invites", tok.tadmin, { email: "x@x.dev", platformRole: "auditor" })).status).toBe(403);
  });

  it("keeps normal auth working (last_login_at is set on login)", async () => {
    await request(app).post("/api/v1/auth/login").send({ email: "padmin@i.dev", password: PW });
    const { rows } = await query<{ last_login_at: string | null }>("SELECT last_login_at FROM users WHERE id = $1", [id.padmin]);
    expect(rows[0].last_login_at).not.toBeNull();
  });
});
