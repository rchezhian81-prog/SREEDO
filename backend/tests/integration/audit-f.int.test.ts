import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";
import { invalidatePermissionCache } from "../../src/middleware/permissions";

// Super Admin F — Audit Consolidation.

const PW = "Passw0rd!x";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const get = (p: string, t: string) => request(app).get(p).set(auth(t));
const post = (p: string, t: string, b?: unknown) => request(app).post(p).set(auth(t)).send(b ?? {});
const put = (p: string, t: string, b: unknown) => request(app).put(p).set(auth(t)).send(b);
const patch = (p: string, t: string, b: unknown) => request(app).patch(p).set(auth(t)).send(b);
const del = (p: string, t: string) => request(app).delete(p).set(auth(t));

const SECRET = "sk_live_secret";
const base = "/api/v1/platform/audit";

describe("Super Admin F — Audit Consolidation", () => {
  let ownerTok = "";
  let owner2Tok = "";
  let instId = "";
  const id: Record<string, string> = {};
  let seededCount = 0;

  async function mkPlatform(email: string, platformRole: string | null): Promise<string> {
    const u = await createUser({ email, password: PW, role: "super_admin", institutionId: null });
    await query("UPDATE users SET platform_role = $2 WHERE id = $1", [u.id, platformRole]);
    return u.id;
  }

  async function seed(o: {
    action: string;
    actorEmail?: string;
    actorRole?: string;
    targetType?: string;
    targetId?: string | null;
    institutionId?: string | null;
    detail?: Record<string, unknown>;
    ip?: string;
  }): Promise<string> {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO platform_audit_log
         (action, target_type, target_id, institution_id, actor_id, actor_email, actor_role, detail, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING id`,
      [
        o.action,
        o.targetType ?? "system",
        o.targetId ?? null,
        o.institutionId ?? null,
        null,
        o.actorEmail ?? "owner@p.dev",
        o.actorRole ?? "super_admin",
        JSON.stringify(o.detail ?? {}),
        o.ip ?? "10.0.0.1",
      ]
    );
    seededCount += 1;
    return rows[0].id;
  }

  beforeEach(async () => {
    await resetDb();
    seededCount = 0;
    await mkPlatform("owner@p.dev", "owner");
    await mkPlatform("owner2@p.dev", "owner");
    ownerTok = await tokenFor("owner@p.dev", PW);
    owner2Tok = await tokenFor("owner2@p.dev", PW);
    instId = await createInstitution("ACME");

    // Seed across categories / severities / results.
    for (let i = 0; i < 5; i++) await seed({ action: "auth.login.failed", actorEmail: "attacker@x.dev", ip: "9.9.9.9" });
    await seed({ action: "auth.login.success", actorEmail: "owner@p.dev" });
    await seed({ action: "auth.login.blocked", actorEmail: "attacker@x.dev", ip: "9.9.9.9" });
    id.rbac = await seed({ action: "rbac.grant", detail: { role: "auditor", permission: "platform:read" } });
    id.invoice = await seed({ action: "invoice.voided", institutionId: instId, detail: { reason: "billing error" } });
    id.token = await seed({ action: "security.api_token_created", detail: { name: "ci" } });
    id.imp = await seed({ action: "impersonate.start", institutionId: instId, detail: { targetEmail: "t@x", reason: "support" } });
    id.gw = await seed({ action: "payment_gateway.settings_changed", detail: { fields: ["keyId"] } });
    id.suspend = await seed({ action: "institution.suspend", targetType: "institution", targetId: instId, institutionId: instId, detail: { reason: "nonpayment" } });
    id.export = await seed({ action: "platform.audit_exported", detail: { format: "csv" } });
    await seed({ action: "backup.create" });
    id.restore = await seed({ action: "restore.failed", detail: { error: "disk" } });
    await seed({ action: "platform.email.test", detail: { to: "a@b.c" } });
    await seed({ action: "subscription.assign", institutionId: instId });
    await seed({ action: "jobs.run_scheduler" });
    id.role = await seed({ action: "platform.admin.role_changed", targetType: "user", detail: { email: "x@y", from: "auditor", to: "owner", reason: "promote" } });
    // A row whose detail carries a fake secret + a diff.
    id.secret = await seed({
      action: "platform.settings_update",
      targetType: "platform_settings",
      detail: { apiKey: SECRET, diff: { status: { from: "a", to: "b" } } },
    });

    // Logging in the two owners above also wrote real auth.login.success rows to
    // the audit store; take the true baseline count so totals line up exactly.
    const total = await query<{ n: number }>("SELECT count(*)::int AS n FROM platform_audit_log");
    seededCount = Number(total.rows[0].n);
  });

  // ---- 1. List: computed columns + new filters + pagination + sort ----
  it("consolidated list computes category/severity/result and honours the new filters", async () => {
    const list = await get(base, ownerTok);
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ page: 1, pageSize: 50 });
    expect(list.body.total).toBe(seededCount);
    // Never leaks raw detail (no secret in the list payload).
    expect(JSON.stringify(list.body)).not.toContain(SECRET);

    const rbacRow = list.body.rows.find((r: { action: string }) => r.action === "rbac.grant");
    expect(rbacRow).toMatchObject({ category: "Authorization/RBAC", severity: "critical", result: "success" });
    // Spot-check invoice / rbac / security actions all appear in the consolidated list.
    const actions = list.body.rows.map((r: { action: string }) => r.action);
    for (const a of ["invoice.voided", "rbac.grant", "security.api_token_created"]) expect(actions).toContain(a);

    // severity filter (in-DB via computed CASE)
    const crit = await get(`${base}?severity=critical&pageSize=200`, ownerTok);
    expect(crit.body.rows.every((r: { severity: string }) => r.severity === "critical")).toBe(true);
    expect(crit.body.rows.some((r: { action: string }) => r.action === "invoice.voided")).toBe(true);

    // category + module(alias) filters
    const inv = await get(`${base}?category=Invoice`, ownerTok);
    expect(inv.body.rows.every((r: { category: string }) => r.category === "Invoice")).toBe(true);
    const exp = await get(`${base}?module=${encodeURIComponent("Data Export")}`, ownerTok);
    expect(exp.body.rows.some((r: { action: string }) => r.action === "platform.audit_exported")).toBe(true);

    // result filters
    const failed = await get(`${base}?result=failed&pageSize=200`, ownerTok);
    expect(failed.body.rows.some((r: { action: string }) => r.action === "restore.failed")).toBe(true);
    expect(failed.body.rows.every((r: { result: string }) => r.result === "failed")).toBe(true);
    const blocked = await get(`${base}?result=blocked`, ownerTok);
    expect(blocked.body.rows.some((r: { action: string }) => r.action === "auth.login.blocked")).toBe(true);

    // actorRole + ip filters
    expect((await get(`${base}?actorRole=super_admin`, ownerTok)).body.total).toBeGreaterThan(0);
    const byIp = await get(`${base}?ip=9.9.9.9`, ownerTok);
    expect(byIp.body.rows.every((r: { action: string }) => r.action.startsWith("auth.login."))).toBe(true);

    // pagination
    const paged = await get(`${base}?pageSize=2&page=1`, ownerTok);
    expect(paged.body.rows.length).toBe(2);
    expect(paged.body.total).toBe(seededCount);

    // sort by severity desc → critical first
    const sorted = await get(`${base}?sort=severity&order=desc`, ownerTok);
    expect(sorted.body.rows[0].severity).toBe("critical");
  });

  // ---- 2. Summary cards ----
  it("summary returns cards, buckets, top actors/tenants and recent critical", async () => {
    const s = await get(`${base}/summary?window=30d`, ownerTok);
    expect(s.status).toBe(200);
    expect(s.body.totalEvents).toBe(seededCount);
    expect(s.body.highRiskCount).toBeGreaterThan(0);
    expect(s.body.failedBlockedCount).toBeGreaterThanOrEqual(6); // 5 failed + 1 blocked
    expect(s.body.buckets).toHaveProperty("tenant");
    expect(s.body.buckets).toHaveProperty("export");
    expect(s.body.topActors.some((r: { actorEmail: string }) => r.actorEmail === "attacker@x.dev")).toBe(true);
    expect(s.body.topTenants.length).toBeGreaterThan(0);
    expect(Array.isArray(s.body.recentCritical)).toBe(true);
    expect(s.body.recentCritical.length).toBeGreaterThan(0);
  });

  // ---- 3. Single event: diff extraction + secret masking ----
  it("single event returns an extracted diff and masks secrets in metadata", async () => {
    const r = await get(`${base}/${id.secret}`, ownerTok);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ action: "platform.settings_update", category: "Settings", severity: "high_risk" });
    expect(r.body.diff).toEqual([{ field: "status", from: "a", to: "b", kind: "changed" }]);
    // Full detail returned but the secret is masked.
    expect(r.body.metadata.apiKey).not.toBe(SECRET);
    expect(r.body.metadata.apiKey).toContain("masked");
    expect(JSON.stringify(r.body)).not.toContain(SECRET);

    // top-level from/to diff (role change) → field derived from the action.
    const role = await get(`${base}/${id.role}`, ownerTok);
    expect(role.body.diff).toEqual([{ field: "role", from: "auditor", to: "owner", kind: "changed" }]);
    expect(role.body.severity).toBe("critical"); // owner change

    expect((await get(`${base}/${crypto.randomUUID()}`, ownerTok)).status).toBe(404);
    expect((await get(`${base}/not-a-uuid`, ownerTok)).status).toBe(400);
  });

  // ---- 4. Governed export: masking, reason gate, audited, CSV + XLSX ----
  it("export masks secrets, requires a reason for a broad export, and is audited", async () => {
    // Broad export (no dateFrom) → reason required.
    expect((await get(`${base}/export?format=csv`, ownerTok)).status).toBe(400);

    const csv = await get(`${base}/export?format=csv&reason=${encodeURIComponent("Quarterly review")}`, ownerTok);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.text).not.toContain(SECRET);
    expect(csv.text).toContain("masked"); // masked summary cell present

    const xlsx = await get(`${base}/export?format=xlsx&reason=${encodeURIComponent("Quarterly review")}`, ownerTok);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers["content-type"]).toMatch(/spreadsheetml/);

    // Non-sensitive export (bounded by dateFrom) → reason optional.
    expect((await get(`${base}/export?format=csv&dateFrom=2000-01-01`, ownerTok)).status).toBe(200);

    const aud = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM platform_audit_log WHERE action = 'audit.exported'"
    );
    expect(Number(aud.rows[0].n)).toBeGreaterThanOrEqual(2);
  });

  // ---- 5. Saved filters CRUD (own + shared; shared audited; owner-scoped) ----
  it("saved-filters CRUD works, audits shared changes, and scopes private filters to the owner", async () => {
    const priv = await post(`${base}/saved-filters`, ownerTok, { name: "My critical", filters: { severity: "critical" } });
    expect(priv.status).toBe(201);
    expect(priv.body.isShared).toBe(false);

    const shared = await post(`${base}/saved-filters`, ownerTok, {
      name: "Shared exports",
      filters: { category: "Data Export" },
      isShared: true,
    });
    expect(shared.status).toBe(201);

    // Owner sees both; owner2 sees only the shared one (not owner's private filter).
    const mine = await get(`${base}/saved-filters`, ownerTok);
    expect(mine.body.map((r: { id: string }) => r.id)).toEqual(expect.arrayContaining([priv.body.id, shared.body.id]));
    const theirs = await get(`${base}/saved-filters`, owner2Tok);
    const theirIds = theirs.body.map((r: { id: string }) => r.id);
    expect(theirIds).toContain(shared.body.id);
    expect(theirIds).not.toContain(priv.body.id);

    // owner2 cannot modify owner's PRIVATE filter.
    expect((await patch(`${base}/saved-filters/${priv.body.id}`, owner2Tok, { name: "hijack" })).status).toBe(403);
    // owner2 CAN manage the shared filter.
    expect((await patch(`${base}/saved-filters/${shared.body.id}`, owner2Tok, { name: "Shared exports v2" })).status).toBe(200);

    expect((await del(`${base}/saved-filters/${priv.body.id}`, ownerTok)).status).toBe(200);
    expect((await del(`${base}/saved-filters/${shared.body.id}`, ownerTok)).status).toBe(200);

    const created = await query<{ n: number }>("SELECT count(*)::int AS n FROM platform_audit_log WHERE action = 'audit.saved_filter_created'");
    const updated = await query<{ n: number }>("SELECT count(*)::int AS n FROM platform_audit_log WHERE action = 'audit.saved_filter_updated'");
    const deleted = await query<{ n: number }>("SELECT count(*)::int AS n FROM platform_audit_log WHERE action = 'audit.saved_filter_deleted'");
    expect(Number(created.rows[0].n)).toBe(1); // only the shared create is audited
    expect(Number(updated.rows[0].n)).toBe(1);
    expect(Number(deleted.rows[0].n)).toBe(1);
  });

  // ---- 6. Retention policy: GET/PUT audited, never hard-deletes ----
  it("retention GET/PUT is audited and never deletes audit history", async () => {
    await query("UPDATE audit_retention_config SET status='not_configured', retention_days=NULL, archive_enabled=false WHERE id = TRUE");
    const before = await query<{ n: number }>("SELECT count(*)::int AS n FROM platform_audit_log");

    const g0 = await get(`${base}/retention`, ownerTok);
    expect(g0.status).toBe(200);
    expect(g0.body.status).toBe("not_configured");
    expect(g0.body.stats.totalEvents).toBe(seededCount);

    const up = await put(`${base}/retention`, ownerTok, { retentionDays: 365, archiveEnabled: false });
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({ status: "configured", retentionDays: 365 });

    expect((await get(`${base}/retention`, ownerTok)).body.status).toBe("configured");

    const aud = await query<{ n: number }>("SELECT count(*)::int AS n FROM platform_audit_log WHERE action = 'audit.retention_updated'");
    expect(Number(aud.rows[0].n)).toBe(1);

    // No hard-delete: the log only grew (by the one audit row).
    const after = await query<{ n: number }>("SELECT count(*)::int AS n FROM platform_audit_log");
    expect(Number(after.rows[0].n)).toBe(Number(before.rows[0].n) + 1);
  });

  // ---- 7. Integrity ----
  it("integrity reports not_enabled (no faked tamper-evidence)", async () => {
    const r = await get(`${base}/integrity`, ownerTok);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ enabled: false, status: "not_enabled" });
    expect(r.body.note).toMatch(/append-only/i);
  });

  // ---- 8. Alerts feed ----
  it("alerts feed flags suspicious activity and links audit rows", async () => {
    const r = await get(`${base}/alerts?window=30d`, ownerTok);
    expect(r.status).toBe(200);
    const keys = r.body.alerts.map((a: { key: string }) => a.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "multiple_failed_logins",
        "owner_or_rbac_change",
        "sensitive_export",
        "backup_restore",
        "impersonation",
        "gateway_change",
      ])
    );
    const failed = r.body.alerts.find((a: { key: string }) => a.key === "multiple_failed_logins");
    expect(failed.count).toBeGreaterThanOrEqual(5);
    expect(failed.auditId).toBeTruthy(); // each alert links to an audit row
  });

  // ---- 9. Categories reference ----
  it("categories reference lists the full taxonomy", async () => {
    const r = await get(`${base}/categories`, ownerTok);
    expect(r.status).toBe(200);
    expect(r.body.categories).toHaveLength(16);
    expect(r.body.severities).toEqual(expect.arrayContaining(["info", "warning", "high_risk", "critical"]));
    expect(r.body.results).toEqual(expect.arrayContaining(["success", "failed", "blocked"]));
    expect(r.body.categories.map((c: { value: string }) => c.value)).toContain("Payment Gateway");
  });

  // ---- 10. RBAC: audit_read can list but export needs audit_export ----
  it("a super_admin with only audit_read can list but is denied export (403) and retention manage (403)", async () => {
    await query("INSERT INTO rbac_roles (key, name, kind) VALUES ('audit_ro','Audit Reader','custom') ON CONFLICT DO NOTHING");
    await query(
      "INSERT INTO role_permissions (role, permission_id) SELECT 'audit_ro', id FROM permissions WHERE key = 'platform:audit_read' ON CONFLICT DO NOTHING"
    );
    invalidatePermissionCache();
    await mkPlatform("reader@p.dev", "audit_ro");
    const t = await tokenFor("reader@p.dev", PW);

    // audit_read → list works.
    expect((await get(base, t)).status).toBe(200);
    // No audit_export → export denied even with a reason.
    expect((await get(`${base}/export?format=csv&reason=need%20it&dateFrom=2000-01-01`, t)).status).toBe(403);
    // No audit_manage → retention PUT denied.
    expect((await put(`${base}/retention`, t, { retentionDays: 90, archiveEnabled: false })).status).toBe(403);
  });

  // ---- 11. Backwards compatibility: old GET /platform/audit still answers ----
  it("the old GET /platform/audit path still returns (served by the new router)", async () => {
    const r = await get("/api/v1/platform/audit", ownerTok);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("rows");
    expect(r.body).toHaveProperty("total");
    // No endpoint ever hard-deletes audit history.
    const cnt = await query<{ n: number }>("SELECT count(*)::int AS n FROM platform_audit_log");
    expect(Number(cnt.rows[0].n)).toBeGreaterThanOrEqual(seededCount);
  });
});
