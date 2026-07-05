import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";
import { moduleForPath } from "../../src/middleware/support-scope";

// Super Admin G — Support Access (Phase 2): tenant notifications, reports, exports,
// approval workflow, expanded module map, stronger masking. These extend Phase 1
// (support-g.int.test.ts) and must leave all Phase-1 properties intact.

const PW = "Passw0rd!x";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const get = (p: string, t: string) => request(app).get(p).set(auth(t));
const post = (p: string, t: string, b?: unknown) => request(app).post(p).set(auth(t)).send(b ?? {});
const base = "/api/v1/platform/support";

function impClaim(token: string): { sid: string; scope: string; modules?: string[]; actorId: string } {
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  return payload.imp;
}

describe("Super Admin G — Support Access (Phase 2)", () => {
  let ownerTok = "";
  let instId = "";
  let targetId = "";

  beforeEach(async () => {
    await resetDb();
    const owner = await createUser({ email: "owner@p.dev", password: PW, role: "super_admin", institutionId: null });
    await query("UPDATE users SET platform_role = 'owner' WHERE id = $1", [owner.id]);
    ownerTok = await tokenFor("owner@p.dev", PW);
    instId = await createInstitution("ACME");
    const target = await createUser({ email: "admin@acme.dev", password: PW, role: "admin", institutionId: instId });
    targetId = target.id;
  });

  const start = (body: Record<string, unknown>) => post(`${base}/sessions`, ownerTok, body);

  // ---- 1. Tenant notification (I) recorded on start ----
  it("records a tenant-notification outcome on start (no secret leaked)", async () => {
    const s = await start({ userId: targetId, reason: "notify on start please", scope: "read_only" });
    expect(s.status).toBe(200);

    const detail = await get(`${base}/sessions/${s.body.session.id}`, ownerTok);
    expect(detail.status).toBe(200);
    // notifyStatus present (SMTP is unconfigured under test → 'skipped'; 'sent' if configured).
    expect(["sent", "skipped"]).toContain(detail.body.notifyStatus);
    expect(detail.body.notifyDetail).toBeTruthy();
    expect(detail.body.notifyDetail.recipient).toBe("admin@acme.dev"); // resolved tenant admin
    // Never a token / secret / mask marker in the stored notification detail.
    const dj = JSON.stringify(detail.body.notifyDetail);
    expect(dj).not.toContain("eyJ"); // no JWT
    expect(dj).not.toContain("password_hash");
    expect(dj).not.toContain("•••");

    // Row-level persistence matches what the API surfaced.
    const row = (
      await query<{ notify_status: string }>("SELECT notify_status FROM platform_impersonation_sessions WHERE id = $1", [
        s.body.session.id,
      ])
    ).rows[0];
    expect(["sent", "skipped"]).toContain(row.notify_status);

    // The dashboard surfaces the "missing notification" counter (skipped is NOT missing).
    const summary = await get(`${base}/summary`, ownerTok);
    expect(typeof summary.body.missingNotificationCount).toBe("number");
  });

  // ---- 2. Reports (J): ten datasets + totals ----
  it("serves all ten report types, each with totals", async () => {
    const s = await start({ userId: targetId, reason: "seed one session for reports", scope: "read_only" });
    await post(`${base}/sessions/${s.body.session.id}/end`, ownerTok);

    const types = [
      "all",
      "active",
      "expired",
      "revoked",
      "tenant-wise",
      "operator-wise",
      "reason-wise",
      "scope-wise",
      "long-running",
      "high-risk",
    ];
    for (const type of types) {
      const r = await get(`${base}/reports?type=${type}`, ownerTok);
      expect(r.status, `type ${type}`).toBe(200);
      expect(r.body.type).toBe(type);
      const t = r.body.totals;
      for (const key of [
        "sessionCount",
        "avgDurationMinutes",
        "activeCount",
        "revokedCount",
        "expiredCount",
        "notificationSentCount",
        "notificationFailedCount",
      ]) {
        expect(typeof t[key], `${type}.${key}`).toBe("number");
      }
      // Row-based reports carry rows; the *-wise reports carry groups.
      const grouped = ["tenant-wise", "operator-wise", "reason-wise", "scope-wise"].includes(type);
      if (grouped) expect(Array.isArray(r.body.groups)).toBe(true);
      else expect(Array.isArray(r.body.rows)).toBe(true);
    }
    // With one ended session in the window, "all" totals count it.
    const all = await get(`${base}/reports?type=all`, ownerTok);
    expect(all.body.totals.sessionCount).toBe(1);
  });

  // ---- 3+4. Exports (F/J): masked CSV + XLSX, reason gate, audited ----
  it("exports masked history + report CSV/XLSX, gates a broad export, and audits it", async () => {
    const s = await start({ userId: targetId, reason: "session for export", scope: "read_only" });
    await post(`${base}/sessions/${s.body.session.id}/end`, ownerTok);

    // Broad (no dateFrom) history export without a reason → 400.
    expect((await get(`${base}/export?format=csv`, ownerTok)).status).toBe(400);

    const csv = await get(`${base}/export?format=csv&reason=${encodeURIComponent("Quarterly review")}`, ownerTok);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.text).toContain("admin@acme.dev"); // curated target column
    expect(csv.text).not.toContain("password"); // no secret columns

    const xlsx = await get(`${base}/export?format=xlsx&reason=${encodeURIComponent("Quarterly review")}`, ownerTok);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers["content-type"]).toMatch(/spreadsheetml/);

    // Bounded export (dateFrom present) → reason optional.
    expect((await get(`${base}/export?format=csv&dateFrom=2000-01-01`, ownerTok)).status).toBe(200);

    // Report export: broad without reason → 400; with reason → 200.
    expect((await get(`${base}/reports/export?type=all&format=csv`, ownerTok)).status).toBe(400);
    const rexp = await get(`${base}/reports/export?type=all&format=csv&reason=${encodeURIComponent("audit pull")}`, ownerTok);
    expect(rexp.status).toBe(200);

    const hist = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM platform_audit_log WHERE action = 'support.history_exported'"
    );
    const rep = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM platform_audit_log WHERE action = 'support.report_exported'"
    );
    expect(Number(hist.rows[0].n)).toBeGreaterThanOrEqual(2); // csv + xlsx + bounded
    expect(Number(rep.rows[0].n)).toBeGreaterThanOrEqual(1);
  });

  // ---- 5. Approval workflow (L): write_enabled gating ----
  it("gates write_enabled behind an approved approval; read_only/module_limited unaffected", async () => {
    // read_only + module_limited never need approval (Phase-1 behaviour preserved).
    const ro = await start({ userId: targetId, reason: "read only needs no approval", scope: "read_only" });
    expect(ro.status).toBe(200);
    await post(`${base}/sessions/${ro.body.session.id}/end`, ownerTok);
    const ml = await start({
      userId: targetId,
      reason: "module limited needs no approval",
      scope: "module_limited",
      modules: ["students"],
    });
    expect(ml.status).toBe(200);
    await post(`${base}/sessions/${ml.body.session.id}/end`, ownerTok);

    // write_enabled WITHOUT an approval → 403.
    const denied = await start({ userId: targetId, reason: "write enabled without approval", scope: "write_enabled" });
    expect(denied.status).toBe(403);

    // Request approval → pending; list shows it.
    const reqd = await post(`${base}/approvals`, ownerTok, {
      userId: targetId,
      reason: "need to correct a record",
      scope: "write_enabled",
      riskReason: "data correction with tenant consent",
    });
    expect(reqd.status).toBe(201);
    expect(reqd.body.status).toBe("pending");
    const approvalId = reqd.body.id as string;
    const list = await get(`${base}/approvals?status=pending`, ownerTok);
    expect((list.body.rows as Array<{ id: string }>).some((r) => r.id === approvalId)).toBe(true);

    // Decide (approved).
    const decided = await post(`${base}/approvals/${approvalId}/decide`, ownerTok, {
      decision: "approved",
      reason: "approved after review",
    });
    expect(decided.status).toBe(200);
    expect(decided.body.status).toBe("approved");

    // write_enabled WITH the approvalId → succeeds.
    const ok = await start({
      userId: targetId,
      reason: "write enabled with approval",
      scope: "write_enabled",
      approvalId,
    });
    expect(ok.status).toBe(200);
    expect(impClaim(ok.body.token as string).scope).toBe("write_enabled");

    // The approval is now consumed and single-use.
    const consumed = (
      await query<{ consumed_at: string | null }>(
        "SELECT consumed_at FROM support_approval_requests WHERE id = $1",
        [approvalId]
      )
    ).rows[0];
    expect(consumed.consumed_at).not.toBeNull();

    await post(`${base}/sessions/${ok.body.session.id}/end`, ownerTok);
    const reuse = await start({
      userId: targetId,
      reason: "reuse a consumed approval",
      scope: "write_enabled",
      approvalId,
    });
    expect(reuse.status).toBe(403); // consumed → no longer valid

    // Audit trail for the workflow.
    const actions = (
      await query<{ action: string }>(
        "SELECT action FROM platform_audit_log WHERE action LIKE 'support.approval_%'"
      )
    ).rows.map((r) => r.action);
    expect(actions).toContain("support.approval_requested");
    expect(actions).toContain("support.approval_approved");
  });

  it("rejects an approval and refuses to re-decide it", async () => {
    const reqd = await post(`${base}/approvals`, ownerTok, {
      userId: targetId,
      reason: "questionable request",
      scope: "write_enabled",
      riskReason: "unclear justification",
    });
    const id = reqd.body.id as string;
    const rej = await post(`${base}/approvals/${id}/decide`, ownerTok, { decision: "rejected", reason: "insufficient reason" });
    expect(rej.status).toBe(200);
    expect(rej.body.status).toBe("rejected");
    // Cannot decide again.
    expect(
      (await post(`${base}/approvals/${id}/decide`, ownerTok, { decision: "approved", reason: "changed my mind" })).status
    ).toBe(400);
    // A rejected approval does not authorise a write_enabled start.
    expect(
      (await start({ userId: targetId, reason: "start on a rejected approval", scope: "write_enabled", approvalId: id })).status
    ).toBe(403);
  });

  // ---- 6. Module map additions + masking ----
  it("resolves the expanded module map (unit) and enforces new mappings (integration)", async () => {
    // Unit: new prefixes resolve; the truly-unmapped stays deny-by-default "other".
    expect(moduleForPath("/online-exams/42")).toBe("exams");
    expect(moduleForPath("/lms")).toBe("exams");
    expect(moduleForPath("/gallery")).toBe("communication");
    expect(moduleForPath("/polls")).toBe("communication");
    expect(moduleForPath("/enrollments")).toBe("students");
    expect(moduleForPath("/classes")).toBe("overview");
    expect(moduleForPath("/timetable/x")).toBe("overview");
    expect(moduleForPath("/library")).toBe("library");
    expect(moduleForPath("/transport/routes")).toBe("transport");
    expect(moduleForPath("/definitely-not-a-module")).toBe("other");

    // Integration: a module_limited["students"] session allows /students but the
    // scope gate denies a differently-mapped route (/library) before it runs.
    const s = await start({ userId: targetId, reason: "module map enforcement", scope: "module_limited", modules: ["students"] });
    const impTok = s.body.token as string;
    expect((await get("/api/v1/students", impTok)).status).not.toBe(403);
    expect((await get("/api/v1/library", impTok)).status).toBe(403);
  });

  it("masks a secret-looking token pasted into a reason (detail + export)", async () => {
    const secret = "sk_live_abc123def456ghi789";
    const s = await start({ userId: targetId, reason: `please rotate ${secret} now`, scope: "read_only" });
    expect(s.status).toBe(200);

    const detail = await get(`${base}/sessions/${s.body.session.id}`, ownerTok);
    expect(detail.body.reason).not.toContain(secret);
    expect(detail.body.reason).toContain("masked");

    const csv = await get(`${base}/export?format=csv&reason=${encodeURIComponent("masking check")}`, ownerTok);
    expect(csv.status).toBe(200);
    expect(csv.text).not.toContain(secret);
    expect(csv.text).toContain("masked");
  });
});
