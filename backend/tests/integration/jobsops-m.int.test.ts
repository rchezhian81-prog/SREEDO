import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";
// Secret sentinel seeded into a job payload + an attempt error — it (and its
// gateway-key prefixes) must NEVER appear in any masked response or export.
const SENTINEL = "SECRETSENTINEL123";
const SECRET_RE = new RegExp(`${SENTINEL}|sk_live|whsec_|apiKey|password`, "i");

type JobSeed = Partial<{
  type: string;
  payload: Record<string, unknown>;
  status: string;
  priority: number;
  attempts: number;
  maxAttempts: number;
  lockedAt: string | null;
  lockedBy: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  queue: string | null;
  institutionId: string | null;
  deadLetteredAt: string | null;
  deadLetterReason: string | null;
}>;

describe("Super Admin M — Background Jobs Console / Queue Governance", () => {
  const tok: Record<string, string> = {};
  let instId: string;
  let scheduleId: string;
  let exportScheduleId: string;
  const ids: Record<string, string> = {};
  const alertIds: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, body?: unknown) =>
    request(app).post(p).set(auth(t)).send(body as object);

  async function insertJob(s: JobSeed = {}): Promise<string> {
    const d = {
      type: "noop",
      payload: {},
      status: "pending",
      priority: 0,
      attempts: 0,
      maxAttempts: 3,
      lockedAt: null,
      lockedBy: null,
      startedAt: null,
      completedAt: null,
      error: null,
      queue: null,
      institutionId: null,
      deadLetteredAt: null,
      deadLetterReason: null,
      ...s,
    };
    const { rows } = await query<{ id: string }>(
      `INSERT INTO jobs (type, payload, status, priority, attempts, max_attempts, locked_at, locked_by,
         started_at, completed_at, error, queue, institution_id, dead_lettered_at, dead_letter_reason)
       VALUES ($1,$2::jsonb,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [
        d.type, JSON.stringify(d.payload), d.status, d.priority, d.attempts, d.maxAttempts, d.lockedAt,
        d.lockedBy, d.startedAt, d.completedAt, d.error, d.queue, d.institutionId, d.deadLetteredAt,
        d.deadLetterReason,
      ]
    );
    return rows[0].id;
  }

  async function auditCount(action: string, targetId?: string): Promise<number> {
    const { rows } = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM platform_audit_log
       WHERE action=$1 ${targetId ? "AND target_id::text=$2" : ""}`,
      targetId ? [action, targetId] : [action]
    );
    return Number(rows[0].n);
  }

  beforeEach(async () => {
    await resetDb();
    await createUser({ email: "root@m.dev", password: PW, role: "super_admin", institutionId: null });
    tok.root = await tokenFor("root@m.dev", PW);
    instId = await createInstitution("MOPS", "school");
    await createUser({ email: "admin@m.dev", password: PW, role: "admin", institutionId: instId });
    tok.tenant = await tokenFor("admin@m.dev", PW);
    await createUser({ email: "stud@m.dev", password: PW, role: "student", institutionId: instId });
    tok.user = await tokenFor("stud@m.dev", PW);

    // Jobs across every state.
    ids.pending = await insertJob({ type: "noop", institutionId: instId, queue: "default" });
    ids.running = await insertJob({
      type: "webhook_deliver",
      status: "running",
      lockedBy: "w-stuck",
      lockedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      startedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      attempts: 1,
      institutionId: instId,
    });
    ids.success = await insertJob({
      type: "scheduled_report_run",
      status: "success",
      completedAt: new Date().toISOString(),
      attempts: 1,
    });
    ids.failed = await insertJob({
      type: "webhook_deliver",
      status: "failed",
      attempts: 3,
      maxAttempts: 3,
      error: "handler failed",
      completedAt: new Date().toISOString(),
      institutionId: instId,
    });
    ids.cancelled = await insertJob({ type: "noop", status: "cancelled", completedAt: new Date().toISOString() });
    ids.deadLetter = await insertJob({
      type: "scheduled_export",
      status: "dead_letter",
      attempts: 3,
      deadLetteredAt: new Date().toISOString(),
      deadLetterReason: "gave up",
    });
    // A job whose payload contains secret-looking values (must be masked everywhere).
    ids.secret = await insertJob({
      type: "scheduled_export",
      status: "failed",
      attempts: 1,
      error: "boom",
      completedAt: new Date().toISOString(),
      payload: {
        apiKey: `sk_live_${SENTINEL}`,
        token: `whsec_${SENTINEL}`,
        scheduleId: instId,
        invoiceId: instId,
      },
    });

    // Attempt history on the failed job (incl. a secret-shaped error → must mask).
    await query(
      `INSERT INTO job_attempts (job_id, attempt_number, status, worker_id, started_at, finished_at, duration_ms, error, result_summary)
       VALUES
         ($1, 1, 'retry',  'w1', now() - interval '2 minutes', now() - interval '2 minutes', 120, $2, NULL),
         ($1, 2, 'failed', 'w1', now() - interval '1 minutes', now() - interval '1 minutes', 130, $2, NULL),
         ($3, 1, 'success','w1', now() - interval '3 minutes', now() - interval '3 minutes', 90, NULL, 'ok')`,
      [ids.failed, `failed with token whsec_${SENTINEL}`, ids.success]
    );

    // A worker heartbeat.
    await query(
      `INSERT INTO worker_heartbeats (worker_id, status, last_heartbeat_at, jobs_processed, jobs_failed, hostname, version)
       VALUES ('w-test', 'online', now(), 10, 2, 'testhost', 'v1')`
    );

    // Two Observability L alerts of JOB types (the one shared alert store).
    const a1 = await query<{ id: string }>(
      `INSERT INTO alerts (rule_name, type, severity, status, service, triggered_at)
       VALUES ('Queue depth', 'queue_depth_high', 'major', 'triggered', 'queue', now()) RETURNING id`
    );
    alertIds.queue = a1.rows[0].id;
    const a2 = await query<{ id: string }>(
      `INSERT INTO alerts (rule_name, type, severity, status, service, triggered_at)
       VALUES ('Worker down', 'worker_down', 'critical', 'triggered', 'worker', now()) RETURNING id`
    );
    alertIds.worker = a2.rows[0].id;
    // A NON-job alert that must never surface on the jobs alert surface.
    await query(
      `INSERT INTO alerts (rule_name, type, severity, status, service, triggered_at)
       VALUES ('Latency', 'latency_high', 'major', 'triggered', 'api', now())`
    );

    // A recurring scheduled report + a scheduled export (real schedule sources).
    scheduleId = (
      await query<{ id: string }>(
        `INSERT INTO scheduled_reports (institution_id, name, frequency, enabled, next_run_at)
         VALUES ($1, 'Daily roster', 'daily', true, now() - interval '1 hour') RETURNING id`,
        [instId]
      )
    ).rows[0].id;
    exportScheduleId = (
      await query<{ id: string }>(
        `INSERT INTO export_schedules (name, scope, format, frequency, enabled, next_run_at)
         VALUES ('Nightly export', 'invoices', 'csv', 'daily', true, now() - interval '1 hour') RETURNING id`
      )
    ).rows[0].id;
  });

  // ---- Dashboard -----------------------------------------------------------

  it("serves the dashboard with the metric cards and no secrets", async () => {
    const res = await get("/api/v1/jobs-ops/summary", tok.root);
    expect(res.status).toBe(200);
    expect(res.body.statuses).toMatchObject({ pending: 1, dead_letter: 1 });
    expect(res.body.statuses.failed).toBeGreaterThanOrEqual(2); // failed + secret job
    expect(res.body.queueDepth).toBe(res.body.statuses.pending + res.body.statuses.running);
    expect(res.body.stuck).toBe(1); // the 20-min-old running job
    expect(res.body.workers.total).toBeGreaterThanOrEqual(1);
    expect(res.body.jobsNeedingAttention).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(res.body.recentAlerts)).toBe(true);
    expect(res.body.recentAlerts.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(res.body)).not.toMatch(SECRET_RE);
  });

  // ---- List: search / filter / paginate / sort -----------------------------

  it("lists jobs with search, filters, pagination and sorting (masked payloads)", async () => {
    // Filter by status.
    const failed = await get("/api/v1/jobs-ops/jobs?status=failed", tok.root);
    expect(failed.status).toBe(200);
    expect(failed.body.rows.every((r: { status: string }) => r.status === "failed")).toBe(true);

    // Derived 'stuck' filter.
    const stuck = await get("/api/v1/jobs-ops/jobs?status=stuck", tok.root);
    expect(stuck.body.rows).toHaveLength(1);
    expect(stuck.body.rows[0].id).toBe(ids.running);

    // Source-module filter (webhook_deliver → Integrations).
    const integ = await get("/api/v1/jobs-ops/jobs?module=Integrations", tok.root);
    expect(integ.body.rows.every((r: { sourceModule: string }) => r.sourceModule === "Integrations")).toBe(true);

    // Search by type.
    const byType = await get("/api/v1/jobs-ops/jobs?q=scheduled_export", tok.root);
    expect(byType.body.total).toBeGreaterThanOrEqual(1);

    // Pagination.
    const page = await get("/api/v1/jobs-ops/jobs?page=1&pageSize=2", tok.root);
    expect(page.body.rows.length).toBeLessThanOrEqual(2);
    expect(page.body.pageSize).toBe(2);

    // Sort by attempts asc.
    const sorted = await get("/api/v1/jobs-ops/jobs?sort=attempts&order=asc", tok.root);
    const attempts = sorted.body.rows.map((r: { attempts: number }) => r.attempts);
    expect([...attempts].sort((a, b) => a - b)).toEqual(attempts);

    // No secret leaks anywhere in the listing.
    expect(JSON.stringify(page.body)).not.toMatch(SECRET_RE);
  });

  // ---- Detail + attempts + masking -----------------------------------------

  it("returns full detail with attempt timeline and a masked payload", async () => {
    const res = await get(`/api/v1/jobs-ops/jobs/${ids.failed}`, tok.root);
    expect(res.status).toBe(200);
    expect(res.body.sourceModule).toBe("Integrations");
    expect(Array.isArray(res.body.attempts)).toBe(true);
    expect(res.body.attempts).toHaveLength(2);
    // Ascending by attempt number.
    expect(res.body.attempts.map((a: { attemptNumber: number }) => a.attemptNumber)).toEqual([1, 2]);
    // The secret-shaped token in the attempt error is masked.
    expect(JSON.stringify(res.body.attempts)).not.toMatch(SECRET_RE);
    expect(res.body.retryPolicy.backoffBaseMs).toBe(30000);

    // 404 for a missing job.
    expect((await get("/api/v1/jobs-ops/jobs/00000000-0000-0000-0000-000000000000", tok.root)).status).toBe(404);

    // The attempts sub-resource mirrors the timeline.
    const at = await get(`/api/v1/jobs-ops/jobs/${ids.failed}/attempts`, tok.root);
    expect(at.body.rows).toHaveLength(2);
  });

  it("masks secret-looking payload values in both detail and export", async () => {
    const detail = await get(`/api/v1/jobs-ops/jobs/${ids.secret}`, tok.root);
    expect(detail.status).toBe(200);
    // Secret keys are dropped and the values never surface.
    expect(JSON.stringify(detail.body)).not.toMatch(SECRET_RE);
    // Non-secret related ids are still surfaced as typed links.
    const linkKeys = detail.body.relatedLinks.map((l: { key: string }) => l.key);
    expect(linkKeys).toContain("scheduleId");

    const exp = await get(
      `/api/v1/jobs-ops/export?format=csv&reason=audit%20review%20export`,
      tok.root
    );
    expect(exp.status).toBe(200);
    expect(exp.headers["content-type"]).toMatch(/text\/csv/);
    expect(exp.text).not.toMatch(SECRET_RE);
  });

  // ---- Actions: state rules ------------------------------------------------

  it("retries a failed job; refuses to retry a running or success job", async () => {
    const ok = await post(`/api/v1/jobs-ops/jobs/${ids.failed}/retry`, tok.root, { reason: "manual retry" });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("pending");

    expect((await post(`/api/v1/jobs-ops/jobs/${ids.running}/retry`, tok.root, {})).status).toBe(400);
    expect((await post(`/api/v1/jobs-ops/jobs/${ids.success}/retry`, tok.root, {})).status).toBe(400);
  });

  it("cancels a pending job; refuses to cancel a completed job", async () => {
    const ok = await post(`/api/v1/jobs-ops/jobs/${ids.pending}/cancel`, tok.root, { reason: "not needed" });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("cancelled");

    expect((await post(`/api/v1/jobs-ops/jobs/${ids.success}/cancel`, tok.root, {})).status).toBe(400);
  });

  it("dead-letters a failed job then requeues it (state rules enforced)", async () => {
    // Cannot dead-letter a pending job.
    expect(
      (await post(`/api/v1/jobs-ops/jobs/${ids.pending}/dead-letter`, tok.root, { reason: "bad job forever" })).status
    ).toBe(400);

    const dl = await post(`/api/v1/jobs-ops/jobs/${ids.failed}/dead-letter`, tok.root, {
      reason: "permanently broken",
    });
    expect(dl.status).toBe(200);
    expect(dl.body.status).toBe("dead_letter");

    // Cannot requeue a non-dead-letter job.
    expect(
      (await post(`/api/v1/jobs-ops/jobs/${ids.success}/requeue`, tok.root, { reason: "try again please" })).status
    ).toBe(400);

    const rq = await post(`/api/v1/jobs-ops/jobs/${ids.failed}/requeue`, tok.root, { reason: "retry after fix" });
    expect(rq.status).toBe(200);
    expect(rq.body.status).toBe("pending");

    // Dead-letter is high-risk → a security event was also written.
    expect(await auditCount("jobs.dead_lettered", ids.failed)).toBeGreaterThanOrEqual(2);
  });

  it("bulk-retries a mix and reports affected + skipped", async () => {
    const res = await post("/api/v1/jobs-ops/bulk", tok.root, {
      action: "retry",
      ids: [ids.failed, ids.success, ids.running],
      reason: "bulk recovery run",
    });
    expect(res.status).toBe(200);
    expect(res.body.requested).toBe(3);
    expect(res.body.affected).toBe(1); // only the failed one is retryable
    expect(res.body.skipped).toHaveLength(2);
    expect(await auditCount("jobs.bulk_action")).toBeGreaterThanOrEqual(1);
  });

  it("requires a reason for high-risk and export actions", async () => {
    // dead-letter without reason → 400 (zod).
    expect((await post(`/api/v1/jobs-ops/jobs/${ids.failed}/dead-letter`, tok.root, {})).status).toBe(400);
    // bulk without reason → 400.
    expect((await post("/api/v1/jobs-ops/bulk", tok.root, { action: "retry", ids: [ids.failed] })).status).toBe(400);
    // export without reason → 400.
    expect((await get("/api/v1/jobs-ops/export?format=csv", tok.root)).status).toBe(400);
  });

  // ---- Workers -------------------------------------------------------------

  it("lists workers with a derived status", async () => {
    const res = await get("/api/v1/jobs-ops/workers", tok.root);
    expect(res.status).toBe(200);
    const w = res.body.workers.find((x: { workerId: string }) => x.workerId === "w-test");
    expect(w).toBeDefined();
    expect(w.status).toBe("online");
    expect(w.jobsProcessed).toBe(10);
    expect(res.body.note).toMatch(/on-demand/i);
  });

  // ---- Schedules -----------------------------------------------------------

  it("aggregates schedules and pauses/resumes/runs one (audited)", async () => {
    const list = await get("/api/v1/jobs-ops/schedules", tok.root);
    expect(list.status).toBe(200);
    const sources = list.body.schedules.map((s: { source: string }) => s.source);
    expect(sources).toContain("reports");
    expect(sources).toContain("backup");
    expect(sources).toContain("export");
    expect(sources).toContain("system");

    // Pause the scheduled report.
    const pause = await post(`/api/v1/jobs-ops/schedules/reports/${scheduleId}/action`, tok.root, {
      action: "pause",
      reason: "maintenance window",
    });
    expect(pause.status).toBe(200);
    expect(pause.body.enabled).toBe(false);
    expect(
      Number((await query<{ e: boolean }>(`SELECT enabled AS e FROM scheduled_reports WHERE id=$1`, [scheduleId])).rows[0].e)
    ).toBeFalsy();

    // Resume it.
    const resume = await post(`/api/v1/jobs-ops/schedules/reports/${scheduleId}/action`, tok.root, {
      action: "resume",
    });
    expect(resume.body.enabled).toBe(true);

    // Run it now → enqueues a scheduled_report_run job.
    const run = await post(`/api/v1/jobs-ops/schedules/reports/${scheduleId}/action`, tok.root, {
      action: "run_now",
    });
    expect(run.body.enqueued).toBe(true);
    expect(run.body.jobId).toBeTruthy();

    // A system schedule cannot be paused, only run.
    expect(
      (await post(`/api/v1/jobs-ops/schedules/system/alert_evaluation/action`, tok.root, { action: "pause" })).status
    ).toBe(400);
    const sysRun = await post(`/api/v1/jobs-ops/schedules/system/alert_evaluation/action`, tok.root, {
      action: "run_now",
    });
    expect(sysRun.status).toBe(200);

    expect(await auditCount("jobs.schedule_paused")).toBeGreaterThanOrEqual(1);
    expect(await auditCount("jobs.schedule_run_now")).toBeGreaterThanOrEqual(2);
  });

  it("requires a reason to pause the critical backup schedule", async () => {
    expect(
      (await post("/api/v1/jobs-ops/schedules/backup/global/action", tok.root, { action: "pause" })).status
    ).toBe(400);
    const ok = await post("/api/v1/jobs-ops/schedules/backup/global/action", tok.root, {
      action: "pause",
      reason: "planned DB maintenance",
    });
    expect(ok.status).toBe(200);
    expect(ok.body.enabled).toBe(false);
  });

  // ---- Alerts (reuse L store) ----------------------------------------------

  it("lists job alerts and acks/resolves them via the shared L store", async () => {
    const list = await get("/api/v1/jobs-ops/alerts", tok.root);
    expect(list.status).toBe(200);
    // Only job/worker/scheduler alert types — never the latency_high one.
    const types = list.body.rows.map((r: { type: string }) => r.type);
    expect(types).toContain("queue_depth_high");
    expect(types).not.toContain("latency_high");

    const ack = await post(`/api/v1/jobs-ops/alerts/${alertIds.queue}/ack`, tok.root, { note: "looking into it" });
    expect(ack.status).toBe(200);
    expect(ack.body.status).toBe("acknowledged");

    const resolve = await post(`/api/v1/jobs-ops/alerts/${alertIds.queue}/resolve`, tok.root, { note: "scaled up" });
    expect(resolve.body.status).toBe("resolved");

    // One store: the alerts row itself now reflects the resolution.
    expect(
      (await query<{ status: string }>(`SELECT status FROM alerts WHERE id=$1`, [alertIds.queue])).rows[0].status
    ).toBe("resolved");
    expect(await auditCount("jobs.alert_acknowledged", alertIds.queue)).toBeGreaterThanOrEqual(1);
  });

  // ---- Reports + retry policy ----------------------------------------------

  it("produces report aggregates and a retry-policy summary", async () => {
    const reports = await get("/api/v1/jobs-ops/reports?window=30d", tok.root);
    expect(reports.status).toBe(200);
    expect(Array.isArray(reports.body.volumeByType)).toBe(true);
    expect(reports.body.statusSummary.dead_letter).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(reports.body.moduleWise)).toBe(true);
    expect(reports.body.queueDepth.total).toBeGreaterThanOrEqual(0);

    const policy = await get("/api/v1/jobs-ops/retry-policy", tok.root);
    expect(policy.body.default.maxAttempts).toBe(3);
    expect(policy.body.default.backoffBaseMs).toBe(30000);
    expect(Array.isArray(policy.body.perType)).toBe(true);
  });

  // ---- Process / integrations ----------------------------------------------

  it("processes due jobs on demand and returns an integrations summary", async () => {
    const proc = await post("/api/v1/jobs-ops/process", tok.root, {});
    expect(proc.status).toBe(200);
    expect(typeof proc.body.processed).toBe("number");
    expect(await auditCount("jobs.processed")).toBeGreaterThanOrEqual(1);

    const integ = await get("/api/v1/jobs-ops/integrations", tok.root);
    expect(integ.status).toBe(200);
    expect(integ.body.observability).toBeDefined();
    expect(integ.body.security.criticalJobAlerts).toBeGreaterThanOrEqual(1); // worker_down critical alert
  });

  // ---- RBAC ----------------------------------------------------------------

  it("blocks tenant admins and plain users from the whole ops surface (403)", async () => {
    for (const t of [tok.tenant, tok.user]) {
      expect((await get("/api/v1/jobs-ops/summary", t)).status).toBe(403);
      expect((await get("/api/v1/jobs-ops/jobs", t)).status).toBe(403);
      expect((await get("/api/v1/jobs-ops/workers", t)).status).toBe(403);
      expect((await get("/api/v1/jobs-ops/reports", t)).status).toBe(403);
      expect((await post(`/api/v1/jobs-ops/jobs/${ids.failed}/retry`, t, { reason: "nope" })).status).toBe(403);
      expect(
        (await post("/api/v1/jobs-ops/bulk", t, { action: "retry", ids: [ids.failed], reason: "nope please" })).status
      ).toBe(403);
      expect((await get("/api/v1/jobs-ops/export?format=csv&reason=trying%20to%20export", t)).status).toBe(403);
    }
  });

  it("audits a mutating action to platform_audit_log", async () => {
    expect(await auditCount("jobs.retried", ids.failed)).toBe(0);
    await post(`/api/v1/jobs-ops/jobs/${ids.failed}/retry`, tok.root, { reason: "audit check" });
    expect(await auditCount("jobs.retried", ids.failed)).toBeGreaterThanOrEqual(1);
  });
});
