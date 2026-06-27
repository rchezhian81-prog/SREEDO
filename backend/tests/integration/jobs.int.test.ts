import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";
import { enqueue } from "../../src/modules/jobs/jobs.service";
import { claimJob, processDueJobs } from "../../src/modules/jobs/jobs.worker";

const PW = "Passw0rd!";

async function jobRow(id: string) {
  const { rows } = await query<Record<string, unknown>>("SELECT * FROM jobs WHERE id=$1", [id]);
  return rows[0];
}

describe("background job queue", () => {
  let instA: string;
  let adminId: string;
  let scheduleId: string;
  const tok: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, body?: unknown) =>
    request(app).post(p).set(auth(t)).send(body as object);

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("JOBS");
    await createUser({ email: "root@j.dev", password: PW, role: "super_admin", institutionId: null });
    tok.root = await tokenFor("root@j.dev", PW);
    const admin = await createUser({ email: "admin@j.dev", password: PW, role: "admin", institutionId: instA });
    adminId = admin.id;
    for (const role of ["accountant", "teacher", "student", "parent"] as const) {
      await createUser({ email: `${role}@j.dev`, password: PW, role, institutionId: instA });
      tok[role] = await tokenFor(`${role}@j.dev`, PW);
    }
    tok.admin = await tokenFor("admin@j.dev", PW);

    // A saved custom report + a scheduled report (for the scheduler-tick path).
    const reportId = (await post("/api/v1/custom-reports", tok.admin, {
      name: "Roster", reportKey: "students", columns: [], visibility: "shared",
    })).body.id;
    scheduleId = (await post("/api/v1/scheduled-reports", tok.admin, {
      reportId, name: "Daily", frequency: "daily", channels: ["in_app"],
      exportFormat: "csv", recipients: [adminId],
    })).body.id;
  });

  it("enqueues jobs and dedupes by key", async () => {
    const a = await enqueue({ type: "noop", institutionId: instA });
    expect(a?.status).toBe("pending");
    const b = await enqueue({ type: "noop", institutionId: instA, dedupeKey: "k1" });
    const dup = await enqueue({ type: "noop", institutionId: instA, dedupeKey: "k1" });
    expect(b).not.toBeNull();
    expect(dup).toBeNull(); // deduped
  });

  it("claims jobs safely without double processing", async () => {
    await enqueue({ type: "noop", institutionId: instA });
    const first = await claimJob("w1", null);
    const second = await claimJob("w2", null);
    expect(first).not.toBeNull();
    expect(second).toBeNull(); // already claimed → not handed out twice
    expect(first?.id).toBeTruthy();
  });

  it("completes a successful job", async () => {
    const job = await enqueue({ type: "noop", institutionId: instA });
    const result = await processDueJobs();
    expect(result.success).toBe(1);
    const row = await jobRow(job!.id);
    expect(row.status).toBe("success");
    expect(row.completed_at).toBeTruthy();
  });

  it("retries a failed job with backoff", async () => {
    const job = await enqueue({ type: "does_not_exist", institutionId: instA, maxAttempts: 3 });
    const result = await processDueJobs();
    expect(result.retried).toBe(1);
    const row = await jobRow(job!.id);
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.error).toContain("Unknown job type");
    // Backoff pushed run_at into the future, so it isn't re-run immediately.
    expect(new Date(row.run_at as string).getTime()).toBeGreaterThan(Date.now());
    expect((await processDueJobs()).processed).toBe(0);
  });

  it("marks a permanent failure after max attempts", async () => {
    const job = await enqueue({ type: "does_not_exist", institutionId: instA, maxAttempts: 1 });
    await processDueJobs();
    const row = await jobRow(job!.id);
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(1);
    expect(row.completed_at).toBeTruthy();
  });

  it("scheduler tick enqueues due scheduled reports without duplicates, then runs them", async () => {
    await query("UPDATE scheduled_reports SET next_run_at = now() - interval '1 hour' WHERE id=$1", [scheduleId]);

    const first = await post("/api/v1/jobs/run-scheduler", tok.admin);
    expect(first.status).toBe(200);
    expect(first.body.enqueued).toBe(1);
    // Second tick: next_run_at already advanced → nothing due → no duplicate.
    expect((await post("/api/v1/jobs/run-scheduler", tok.admin)).body.enqueued).toBe(0);

    const jobs = await get("/api/v1/jobs?type=scheduled_report_run", tok.admin);
    expect(jobs.body).toHaveLength(1);
    expect(jobs.body[0].payload.scheduleId).toBe(scheduleId);

    // Drain the queue → the schedule actually runs (records a scheduled run).
    expect((await post("/api/v1/jobs/process", tok.admin)).body.success).toBe(1);
    const runs = await get(`/api/v1/scheduled-reports/${scheduleId}/runs`, tok.admin);
    expect(runs.body.some((r: { trigger: string; status: string }) => r.trigger === "scheduled" && r.status === "success")).toBe(true);
  });

  it("keeps manual scheduled-report runs working", async () => {
    const run = await post(`/api/v1/scheduled-reports/${scheduleId}/run`, tok.admin);
    expect(run.body.status).toBe("success");
  });

  it("gates retry and cancel by permission", async () => {
    const failed = await enqueue({ type: "does_not_exist", institutionId: instA, maxAttempts: 1 });
    await processDueJobs();
    const pending = await enqueue({ type: "noop", institutionId: instA });

    for (const role of ["accountant", "teacher", "student", "parent"] as const) {
      expect((await post(`/api/v1/jobs/${failed!.id}/retry`, tok[role])).status).toBe(403);
      expect((await post(`/api/v1/jobs/${pending!.id}/cancel`, tok[role])).status).toBe(403);
    }
    // admin can.
    expect((await post(`/api/v1/jobs/${failed!.id}/retry`, tok.admin)).body.status).toBe("pending");
    expect((await post(`/api/v1/jobs/${pending!.id}/cancel`, tok.admin)).body.status).toBe("cancelled");
  });

  it("blocks students/parents from the job console", async () => {
    expect((await get("/api/v1/jobs", tok.student)).status).toBe(403);
    expect((await get("/api/v1/jobs", tok.parent)).status).toBe(403);
    expect((await post("/api/v1/jobs/run-scheduler", tok.teacher)).status).toBe(403);
  });

  it("is tenant-isolated; super admin sees platform-wide", async () => {
    const job = await enqueue({ type: "noop", institutionId: instA });

    const instB = await createInstitution("JOBS2");
    await createUser({ email: "admin@j2.dev", password: PW, role: "admin", institutionId: instB });
    const bAdmin = await tokenFor("admin@j2.dev", PW);

    // instB admin sees none of instA's jobs.
    expect((await get("/api/v1/jobs", bAdmin)).body.some((j: { id: string }) => j.id === job!.id)).toBe(false);
    expect((await get(`/api/v1/jobs/${job!.id}`, bAdmin)).status).toBe(404);
    expect((await post(`/api/v1/jobs/${job!.id}/cancel`, bAdmin)).status).toBe(404);
    // instA admin + super_admin both see it.
    expect((await get(`/api/v1/jobs/${job!.id}`, tok.admin)).status).toBe(200);
    expect((await get(`/api/v1/jobs/${job!.id}`, tok.root)).status).toBe(200);
  });

  it("never leaks secrets in payloads or error output", async () => {
    await query("UPDATE scheduled_reports SET next_run_at = now() - interval '1 hour' WHERE id=$1", [scheduleId]);
    await post("/api/v1/jobs/run-scheduler", tok.admin);
    const job = (await get("/api/v1/jobs?type=scheduled_report_run", tok.admin)).body[0];
    // Payload is just the schedule reference — no tokens/passwords/secrets.
    expect(Object.keys(job.payload)).toEqual(["scheduleId"]);
    expect(JSON.stringify(job)).not.toMatch(/password|secret|token|accessToken/i);

    const failed = await enqueue({ type: "does_not_exist", institutionId: instA, maxAttempts: 1 });
    await processDueJobs();
    const row = await get(`/api/v1/jobs/${failed!.id}`, tok.admin);
    expect(row.body.error).not.toMatch(/password|secret|token/i);
  });
});
