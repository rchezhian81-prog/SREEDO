import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";
import { evaluateAlertRules } from "../../src/modules/observability/alerts.service";

const PW = "Passw0rd!";
// A sentinel gateway secret seeded into the DB — it must NEVER reach any response.
const SECRET_SENTINEL = "SUPERSECRETVALUE123";
// A sentinel raw storage path — the storage dashboard must never leak it.
const RAW_PATH_SENTINEL = "RAWPATHSENTINEL";
// Nothing in any health/service/error/storage/smtp response may match this.
const SECRET_RE =
  /password|secret|token|bcrypt|storage_key|storageKey|accessKey|\$2[aby]\$|SUPERSECRET|whsec_/i;

/** Super Admin L — Health / Observability. */
describe("Super Admin L — Health / Observability", () => {
  const tok: Record<string, string> = {};
  let instId: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, body?: unknown) =>
    request(app).post(p).set(auth(t)).send(body as object);
  const patch = (p: string, t: string, body?: unknown) =>
    request(app).patch(p).set(auth(t)).send(body as object);
  const del = (p: string, t: string) => request(app).delete(p).set(auth(t));

  /** The error-capture middleware records on res.finish (fire-and-forget), so
   *  poll briefly until the expected captured error has committed. */
  async function waitForError(statusCode: number, tries = 60): Promise<void> {
    for (let i = 0; i < tries; i += 1) {
      const n = Number(
        (
          await query<{ n: number }>("SELECT count(*)::int AS n FROM error_events WHERE status_code = $1", [
            statusCode,
          ])
        ).rows[0].n
      );
      if (n >= 1) return;
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  beforeEach(async () => {
    await resetDb();
    await createUser({ email: "root@l.dev", password: PW, role: "super_admin", institutionId: null });
    tok.root = await tokenFor("root@l.dev", PW);
    instId = await createInstitution("LOBS", "school");
    // A tenant admin (non-super-admin) for the RBAC boundary tests.
    await createUser({ email: "admin@l.dev", password: PW, role: "admin", institutionId: instId });
    tok.tenant = await tokenFor("admin@l.dev", PW);
    // Seed a gateway secret so the no-secret assertions have something to catch.
    await query(
      `INSERT INTO saas_payment_gateway_settings (id, enabled, key_id, key_secret, webhook_secret)
       VALUES (TRUE, TRUE, 'rzp_test_key', $1, $2)
       ON CONFLICT (id) DO UPDATE SET enabled = TRUE, key_id = 'rzp_test_key',
         key_secret = EXCLUDED.key_secret, webhook_secret = EXCLUDED.webhook_secret`,
      [`sk_${SECRET_SENTINEL}`, `whsec_${SECRET_SENTINEL}`]
    );
  });

  // ---- Dashboard + service health -----------------------------------------

  it("serves the health dashboard with service statuses and no secrets", async () => {
    const res = await get("/api/v1/observability/summary", tok.root);
    expect(res.status).toBe(200);
    expect(res.body.overall).toBeDefined();
    expect(res.body.overall.status).toMatch(/healthy|degraded|down/);
    expect(Array.isArray(res.body.services)).toBe(true);
    // Core service cards are present.
    const names = res.body.services.map((s: { service: string }) => s.service);
    for (const n of ["api", "database", "storage", "smtp", "gateway", "queue", "memory"]) {
      expect(names).toContain(n);
    }
    // Every card is status-only (healthy/degraded/down/unknown) with a short detail.
    for (const s of res.body.services) {
      expect(s.status).toMatch(/healthy|degraded|down|unknown/);
      expect(typeof s.detail).toBe("string");
    }
    // The storage card must be status-only — never the local disk PATH (local
    // mode) or the S3 bucket/host, which are storage paths and must not surface.
    const storageCard = res.body.services.find((s: { service: string }) => s.service === "storage");
    expect(storageCard).toBeDefined();
    expect(storageCard.detail).not.toMatch(/\/\w+\/\w+|uploads|\/home\//i);
    expect(res.body.metrics).toBeDefined();
    expect(res.body.incidents).toBeDefined();
    expect(res.body.alerts).toBeDefined();
    // NO secrets anywhere.
    expect(JSON.stringify(res.body)).not.toMatch(SECRET_RE);
  });

  it("runs service health checks and persists them to service_health_history", async () => {
    const before = Number(
      (await query<{ n: number }>("SELECT count(*)::int AS n FROM service_health_history")).rows[0].n
    );
    const res = await get("/api/v1/observability/services", tok.root);
    expect(res.status).toBe(200);
    expect(res.body.overall).toBeDefined();
    expect(res.body.services.length).toBeGreaterThan(5);
    const after = Number(
      (await query<{ n: number }>("SELECT count(*)::int AS n FROM service_health_history")).rows[0].n
    );
    expect(after).toBeGreaterThan(before);
    expect(JSON.stringify(res.body)).not.toMatch(SECRET_RE);

    // POST /services/run (observability:run) is audited.
    const run = await post("/api/v1/observability/services/run", tok.root, {});
    expect(run.status).toBe(200);
    const audit = await get("/api/v1/platform/audit?action=observability.health_checked", tok.root);
    expect(audit.body.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("returns per-service uptime history", async () => {
    await get("/api/v1/observability/services", tok.root); // seed history
    const res = await get("/api/v1/observability/uptime", tok.root);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.services)).toBe(true);
    expect(res.body.services.length).toBeGreaterThan(0);
    const dbSvc = res.body.services.find((s: { service: string }) => s.service === "database");
    expect(dbSvc).toBeDefined();
    expect(dbSvc.uptimePct === null || typeof dbSvc.uptimePct === "number").toBe(true);
  });

  it("loads performance, storage, smtp, jobs-health and integrations (no secrets)", async () => {
    // A document with a raw storage path — the storage view must never leak it.
    await query(
      `INSERT INTO documents (institution_id, owner_type, category, original_name, safe_name,
                              mime_type, size_bytes, storage_key, storage_mode)
       VALUES ($1,'institution','document','report.pdf','safe.pdf','application/pdf',1048576,$2,'local')`,
      [instId, `documents/${RAW_PATH_SENTINEL}.pdf`]
    );

    const perf = await get("/api/v1/observability/performance", tok.root);
    expect(perf.status).toBe(200);
    expect(perf.body.requests).toBeDefined();
    expect(Array.isArray(perf.body.slowRoutes)).toBe(true);

    const storage = await get("/api/v1/observability/storage", tok.root);
    expect(storage.status).toBe(200);
    expect(storage.body.totalBytes).toBeGreaterThanOrEqual(1048576);
    expect(storage.body.byTenant.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(storage.body)).not.toContain(RAW_PATH_SENTINEL);
    expect(JSON.stringify(storage.body)).not.toMatch(SECRET_RE);

    const smtp = await get("/api/v1/observability/smtp", tok.root);
    expect(smtp.status).toBe(200);
    expect(smtp.body.delivery).toBeDefined();
    expect(smtp.body).not.toHaveProperty("error");
    expect(JSON.stringify(smtp.body)).not.toMatch(SECRET_RE);

    const jobs = await get("/api/v1/observability/jobs-health", tok.root);
    expect(jobs.status).toBe(200);
    expect(jobs.body.queue).toBeDefined();

    const integ = await get("/api/v1/observability/integrations", tok.root);
    expect(integ.status).toBe(200);
    expect(integ.body.backups).toBeDefined();
    expect(integ.body.exports).toBeDefined();
    expect(integ.body.security).toBeDefined();
    expect(JSON.stringify(integ.body)).not.toMatch(SECRET_RE);
  });

  // ---- Incidents -----------------------------------------------------------

  it("drives an incident create → update → resolve → reopen with a timeline, audited, never hard-deleted", async () => {
    const created = await post("/api/v1/observability/incidents", tok.root, {
      title: "API latency spike",
      severity: "critical",
      type: "api",
      impact: "Slow responses for tenants",
      note: "Paged on-call",
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("open");
    expect(created.body.severity).toBe("critical");
    const id = created.body.id;

    // Critical create is audited (and, via the high-risk regex, surfaces there).
    const createdAudit = await get("/api/v1/platform/audit?action=incident.created", tok.root);
    expect(createdAudit.body.rows.length).toBeGreaterThanOrEqual(1);

    // Update → investigating.
    const upd = await patch(`/api/v1/observability/incidents/${id}`, tok.root, {
      status: "investigating",
      note: "Rolling back a deploy",
    });
    expect(upd.status).toBe(200);
    expect(upd.body.status).toBe("investigating");

    // Resolve → resolved_at set + audited.
    const resolved = await post(`/api/v1/observability/incidents/${id}/resolve`, tok.root, {
      resolution: "Rolled back; latency normal",
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe("resolved");
    expect(resolved.body.resolvedAt).toBeTruthy();
    const resolveAudit = await get("/api/v1/platform/audit?action=incident.resolved", tok.root);
    expect(resolveAudit.body.rows.length).toBeGreaterThanOrEqual(1);

    // Reopen → resolved_at cleared.
    const reopened = await post(`/api/v1/observability/incidents/${id}/reopen`, tok.root, {
      note: "Recurred",
    });
    expect(reopened.status).toBe(200);
    expect(reopened.body.status).toBe("investigating");
    expect(reopened.body.resolvedAt).toBeNull();

    // Timeline captured every transition.
    const detail = await get(`/api/v1/observability/incidents/${id}`, tok.root);
    const kinds = detail.body.timeline.map((e: { kind: string }) => e.kind);
    expect(kinds).toContain("created");
    expect(kinds).toContain("resolved");
    expect(kinds).toContain("reopened");

    // NO hard delete: the row + its timeline are retained and there is no DELETE route.
    const attemptedDelete = await del(`/api/v1/observability/incidents/${id}`, tok.root);
    expect(attemptedDelete.status).toBe(404); // no such route
    const rowCount = Number(
      (await query<{ n: number }>("SELECT count(*)::int AS n FROM incidents")).rows[0].n
    );
    expect(rowCount).toBe(1);
    const eventCount = Number(
      (await query<{ n: number }>("SELECT count(*)::int AS n FROM incident_events")).rows[0].n
    );
    expect(eventCount).toBeGreaterThanOrEqual(3);

    // Filter/list works.
    const list = await get("/api/v1/observability/incidents?active=true", tok.root);
    expect(list.body.total).toBeGreaterThanOrEqual(1);
  });

  // ---- Alert rules + feed + evaluation ------------------------------------

  it("manages alert rules (create / edit / disable / test)", async () => {
    const created = await post("/api/v1/observability/alert-rules", tok.root, {
      name: "Queue backlog",
      type: "queue_depth_high",
      threshold: 100,
      severity: "major",
    });
    expect(created.status).toBe(201);
    expect(created.body.enabled).toBe(true);
    const id = created.body.id;
    const ruleAudit = await get("/api/v1/platform/audit?action=alert.rule_created", tok.root);
    expect(ruleAudit.body.rows.length).toBeGreaterThanOrEqual(1);

    const disabled = await patch(`/api/v1/observability/alert-rules/${id}`, tok.root, { enabled: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.enabled).toBe(false);

    // Test fires a synthetic SUPPRESSED alert (no real notification).
    const tested = await post(`/api/v1/observability/alert-rules/${id}/test`, tok.root, {});
    expect(tested.status).toBe(200);
    expect(tested.body.tested).toBe(true);
    expect(tested.body.alert.status).toBe("suppressed");
  });

  it("triggers an alert when a threshold is breached, then acks/resolves it (never hard-deleted)", async () => {
    // Seed a breach: two failed jobs today.
    await query(
      `INSERT INTO jobs (type, status, completed_at) VALUES
         ('noop','failed', now()), ('noop','failed', now())`
    );
    const rule = await post("/api/v1/observability/alert-rules", tok.root, {
      name: "Job failure spike",
      type: "job_failure_spike",
      threshold: 1,
      severity: "critical",
      cooldownMinutes: 0,
    });
    expect(rule.status).toBe(201);

    // Evaluate → an alert row is created.
    const result = await evaluateAlertRules();
    expect(result.triggered).toBeGreaterThanOrEqual(1);

    const feed = await get("/api/v1/observability/alerts", tok.root);
    expect(feed.status).toBe(200);
    const triggered = feed.body.rows.find(
      (a: { type: string; status: string }) => a.type === "job_failure_spike" && a.status === "triggered"
    );
    expect(triggered).toBeDefined();
    const alertId = triggered.id;

    // A critical trigger is audited (high-risk feed).
    const trigAudit = await get("/api/v1/platform/audit?action=alert.triggered", tok.root);
    expect(trigAudit.body.rows.length).toBeGreaterThanOrEqual(1);

    // Ack → acknowledged; resolve → resolved (status transitions, not deletes).
    const ack = await post(`/api/v1/observability/alerts/${alertId}/ack`, tok.root, { note: "looking" });
    expect(ack.status).toBe(200);
    expect(ack.body.status).toBe("acknowledged");
    const resolve = await post(`/api/v1/observability/alerts/${alertId}/resolve`, tok.root, {});
    expect(resolve.status).toBe(200);
    expect(resolve.body.status).toBe("resolved");

    // Link to an incident.
    const inc = await post("/api/v1/observability/incidents", tok.root, { title: "Worker backlog", type: "worker" });
    const link = await post(`/api/v1/observability/alerts/${alertId}/link-incident`, tok.root, {
      incidentId: inc.body.id,
    });
    expect(link.status).toBe(200);
    expect(link.body.incidentId).toBe(inc.body.id);

    // No hard delete: the alert row is retained.
    const alertCount = Number(
      (await query<{ n: number }>("SELECT count(*)::int AS n FROM alerts WHERE id = $1", [alertId])).rows[0].n
    );
    expect(alertCount).toBe(1);

    // Reason-gated export.
    const noReason = await get("/api/v1/observability/alerts/export", tok.root);
    expect(noReason.status).toBe(400);
    const csv = await get("/api/v1/observability/alerts/export?reason=incident-review", tok.root).buffer(true);
    expect(csv.status).toBe(200);
  });

  // ---- Error explorer ------------------------------------------------------

  it("captures 4xx/5xx into the error explorer, lists/filters and triages them (masked)", async () => {
    // Generate a 404 and a 400 through the real app so the capture middleware records them.
    await get(`/api/v1/observability/incidents/${"00000000-0000-0000-0000-000000000000"}`, tok.root); // 404
    await get("/api/v1/observability/uptime?window=nope", tok.root); // 400 (zod)
    await waitForError(404);

    const list = await get("/api/v1/observability/errors", tok.root);
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThanOrEqual(1);
    // Messages are strings, masked, and never carry a stack/secret.
    for (const r of list.body.rows) {
      expect(typeof r.message).toBe("string");
      expect(r).not.toHaveProperty("stack");
    }
    expect(JSON.stringify(list.body)).not.toMatch(SECRET_RE);

    // Filter by status code.
    const only404 = await get("/api/v1/observability/errors?statusCode=404", tok.root);
    expect(only404.body.rows.every((r: { statusCode: number }) => r.statusCode === 404)).toBe(true);

    // Summary aggregates.
    const summary = await get("/api/v1/observability/errors/summary", tok.root);
    expect(summary.status).toBe(200);
    expect(summary.body.totals.distinctErrors).toBeGreaterThanOrEqual(1);

    // Triage the first error.
    const first = list.body.rows[0];
    const triaged = await patch(`/api/v1/observability/errors/${first.id}`, tok.root, {
      status: "investigating",
      note: "under review",
    });
    expect(triaged.status).toBe(200);
    expect(triaged.body.status).toBe("investigating");
    const triageAudit = await get("/api/v1/platform/audit?action=error.triage", tok.root);
    expect(triageAudit.body.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("serves a safe log summary (masked error_events + audit)", async () => {
    await get("/api/v1/observability/does-not-exist", tok.root); // seed a 404 error_event
    const logs = await get("/api/v1/observability/logs", tok.root);
    expect(logs.status).toBe(200);
    expect(Array.isArray(logs.body.errors)).toBe(true);
    expect(Array.isArray(logs.body.audit)).toBe(true);
    expect(JSON.stringify(logs.body)).not.toMatch(SECRET_RE);

    // Broad log export is reason-gated.
    const noReason = await get("/api/v1/observability/logs/export", tok.root);
    expect(noReason.status).toBe(400);
    const csv = await get("/api/v1/observability/logs/export?reason=ops-review", tok.root).buffer(true);
    expect(csv.status).toBe(200);
  });

  // ---- RBAC ----------------------------------------------------------------

  it("forbids a non-super-admin from every observability surface (RBAC 403)", async () => {
    for (const path of [
      "/api/v1/observability/summary",
      "/api/v1/observability/services",
      "/api/v1/observability/uptime",
      "/api/v1/observability/performance",
      "/api/v1/observability/storage",
      "/api/v1/observability/incidents",
      "/api/v1/observability/alerts",
      "/api/v1/observability/alert-rules",
      "/api/v1/observability/errors",
    ]) {
      expect((await get(path, tok.tenant)).status).toBe(403);
    }
    expect((await post("/api/v1/observability/incidents", tok.tenant, { title: "x" })).status).toBe(403);
    expect(
      (await post("/api/v1/observability/alert-rules", tok.tenant, { name: "x", type: "api_down" })).status
    ).toBe(403);
  });
});
