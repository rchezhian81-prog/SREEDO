import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";

// Super Admin G — Support Access Hardening (Phase 1): stateful, scope-enforced,
// revocable, audited support sessions. These tests prove the security properties
// AND that the scope-enforcement middleware is a strict no-op for normal traffic.

const PW = "Passw0rd!x";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const get = (p: string, t: string) => request(app).get(p).set(auth(t));
const post = (p: string, t: string, b?: unknown) => request(app).post(p).set(auth(t)).send(b ?? {});
const base = "/api/v1/platform/support";

/** Decode a JWT payload (no verification — inspecting our own issued token). */
function impClaim(token: string): { sid: string; scope: string; modules?: string[]; actorId: string } {
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  return payload.imp;
}

describe("Super Admin G — Support Access Hardening", () => {
  let ownerTok = "";
  let adminTok = "";
  let instId = "";
  let targetId = "";
  let ownerId = "";

  beforeEach(async () => {
    await resetDb();
    const owner = await createUser({ email: "owner@p.dev", password: PW, role: "super_admin", institutionId: null });
    ownerId = owner.id;
    await query("UPDATE users SET platform_role = 'owner' WHERE id = $1", [owner.id]);
    ownerTok = await tokenFor("owner@p.dev", PW);
    instId = await createInstitution("ACME");
    const target = await createUser({ email: "admin@acme.dev", password: PW, role: "admin", institutionId: instId });
    targetId = target.id;
    adminTok = await tokenFor("admin@acme.dev", PW);
  });

  const start = (body: Record<string, unknown>) => post(`${base}/sessions`, ownerTok, body);

  it("validates start (reason min 8) and returns a scope-bound imp token", async () => {
    expect((await start({ userId: targetId, reason: "short" })).status).toBe(400); // < 8 chars
    expect((await start({ userId: targetId })).status).toBe(400); // no reason

    const ok = await start({ userId: targetId, reason: "Investigating a billing issue", scope: "read_only", expiryMinutes: 30 });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
    const imp = impClaim(ok.body.token);
    expect(imp.sid).toBe(ok.body.session.id);
    expect(imp.scope).toBe("read_only");
    const row = (await query("SELECT status FROM platform_impersonation_sessions WHERE id = $1", [ok.body.session.id])).rows[0];
    expect(row.status).toBe("active");
  });

  it("cannot start against a super admin", async () => {
    expect((await start({ userId: ownerId, reason: "should not be allowed" })).status).toBe(400);
  });

  it("enforces a single active session per operator (409)", async () => {
    expect((await start({ userId: targetId, reason: "first session is fine" })).status).toBe(200);
    expect((await start({ userId: targetId, reason: "second session is blocked" })).status).toBe(409);
  });

  it("read_only scope blocks mutation (403 + audited) but allows context", async () => {
    const s = await start({ userId: targetId, reason: "read only support", scope: "read_only" });
    const impTok = s.body.token as string;
    expect((await get("/api/v1/auth/me", impTok)).status).toBe(200); // always-allowed context
    const blocked = await post("/api/v1/students", impTok, { name: "x" });
    expect(blocked.status).toBe(403); // the scope gate blocks before the route
    const audited = await query("SELECT 1 FROM platform_audit_log WHERE action = 'support.scope_blocked'");
    expect(audited.rows.length).toBeGreaterThan(0);
  });

  it("module_limited scope blocks disallowed modules (403)", async () => {
    const s = await start({ userId: targetId, reason: "module limited support", scope: "module_limited", modules: ["students"] });
    const impTok = s.body.token as string;
    expect(impClaim(impTok).modules).toEqual(["students"]);
    expect((await get("/api/v1/auth/me", impTok)).status).toBe(200); // context always allowed
    expect((await get("/api/v1/fees", impTok)).status).toBe(403); // fees not in the allowlist
  });

  it("revoke rejects the live token immediately (401) and records the reason", async () => {
    const s = await start({ userId: targetId, reason: "session to revoke" });
    const impTok = s.body.token as string;
    expect((await get("/api/v1/auth/me", impTok)).status).toBe(200);
    const rev = await post(`${base}/sessions/${s.body.session.id}/revoke`, ownerTok, { reason: "no longer required" });
    expect(rev.status).toBe(200);
    expect((await get("/api/v1/auth/me", impTok)).status).toBe(401); // immediate loss
    const row = (await query("SELECT status, revoke_reason FROM platform_impersonation_sessions WHERE id = $1", [s.body.session.id])).rows[0];
    expect(row.status).toBe("revoked");
    expect(row.revoke_reason).toBe("no longer required");
  });

  it("expired session loses access and is swept to 'expired'", async () => {
    const s = await start({ userId: targetId, reason: "session that will expire" });
    const impTok = s.body.token as string;
    await query("UPDATE platform_impersonation_sessions SET expires_at = now() - interval '1 minute' WHERE id = $1", [s.body.session.id]);
    expect((await get("/api/v1/auth/me", impTok)).status).toBe(401);
    await get(`${base}/sessions`, ownerTok); // a read sweeps expired sessions
    const row = (await query("SELECT status FROM platform_impersonation_sessions WHERE id = $1", [s.body.session.id])).rows[0];
    expect(row.status).toBe("expired");
  });

  it("ends a session (status 'ended', token rejected)", async () => {
    const s = await start({ userId: targetId, reason: "session to end normally" });
    const impTok = s.body.token as string;
    expect((await post(`${base}/sessions/${s.body.session.id}/end`, ownerTok)).status).toBe(200);
    expect((await get("/api/v1/auth/me", impTok)).status).toBe(401);
    const row = (await query("SELECT status FROM platform_impersonation_sessions WHERE id = $1", [s.body.session.id])).rows[0];
    expect(row.status).toBe("ended");
  });

  it("serves history (filtered), detail, summary, security-summary and templates", async () => {
    const s = await start({ userId: targetId, reason: "session for reporting", scope: "read_only" });
    await post(`${base}/sessions/${s.body.session.id}/end`, ownerTok);

    const hist = await get(`${base}/sessions?status=ended`, ownerTok);
    expect(hist.status).toBe(200);
    expect(hist.body.rows.length).toBeGreaterThan(0);

    const detail = await get(`${base}/sessions/${s.body.session.id}`, ownerTok);
    expect(detail.status).toBe(200);
    expect(detail.body.targetEmail).toBe("admin@acme.dev");
    // Timestamps must survive the secret masker (Date columns, not flattened to {}).
    expect(typeof detail.body.startedAt).toBe("string");
    expect(Number.isNaN(new Date(detail.body.startedAt).getTime())).toBe(false);
    expect(typeof detail.body.expiresAt).toBe("string");

    const summary = await get(`${base}/summary`, ownerTok);
    expect(summary.status).toBe(200);
    expect(typeof summary.body.activeCount).toBe("number");

    expect((await get(`${base}/security-summary`, ownerTok)).status).toBe(200);

    const tpl = await get(`${base}/templates`, ownerTok);
    expect(tpl.body.templates.length).toBeGreaterThan(0);
    expect(tpl.body.modules.length).toBeGreaterThan(0);
    expect(tpl.body.scopes).toContain("read_only");
  });

  it("denies non-super-admins the support console (403)", async () => {
    expect((await post(`${base}/sessions`, adminTok, { userId: targetId, reason: "should be blocked" })).status).toBe(403);
    expect((await get(`${base}/summary`, adminTok)).status).toBe(403);
    expect((await post(`${base}/revoke-by-tenant`, adminTok, { institutionId: instId, reason: "blocked" })).status).toBe(403);
  });

  it("leaves normal (non-imp) traffic unaffected; invalid tokens still 401", async () => {
    // A normal tenant-admin token reads its own identity and is NOT blocked by the
    // scope middleware (it carries no `imp` claim) — the safety guarantee.
    expect((await get("/api/v1/auth/me", adminTok)).status).toBe(200);
    // A garbage token is still rejected by authenticate, not swallowed by the gate.
    expect((await get("/api/v1/auth/me", "not.a.jwt")).status).toBe(401);
  });

  it("never hard-deletes session history (rows survive end + revoke)", async () => {
    const s1 = await start({ userId: targetId, reason: "first session ended" });
    await post(`${base}/sessions/${s1.body.session.id}/end`, ownerTok);
    const s2 = await start({ userId: targetId, reason: "second session revoked" });
    await post(`${base}/sessions/${s2.body.session.id}/revoke`, ownerTok, { reason: "cleanup" });
    const n = (await query("SELECT count(*)::int AS n FROM platform_impersonation_sessions")).rows[0].n;
    expect(Number(n)).toBe(2);
  });

  it("surfaces support.* events in the consolidated platform audit log", async () => {
    const s = await start({ userId: targetId, reason: "session for the audit log" });
    await post(`${base}/sessions/${s.body.session.id}/revoke`, ownerTok, { reason: "audit check" });
    const audit = await get("/api/v1/platform/audit?q=support", ownerTok);
    expect(audit.status).toBe(200);
    const actions = (audit.body.rows as Array<{ action: string }>).map((r) => r.action);
    expect(actions).toContain("support.session_started");
    expect(actions).toContain("support.session_revoked");
  });
});
