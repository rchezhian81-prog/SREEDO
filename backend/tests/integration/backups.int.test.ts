import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";
import { enqueueDueScheduledBackups } from "../../src/modules/backups/backups.service";
import { processDueJobs } from "../../src/modules/jobs/jobs.worker";

const PW = "Passw0rd!";

describe("scheduled backup / restore automation", () => {
  let instA: string;
  const tok: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, body?: unknown) =>
    request(app).post(p).set(auth(t)).send(body as object);
  const patch = (p: string, t: string, body?: unknown) =>
    request(app).patch(p).set(auth(t)).send(body as object);

  const makeBackup = async (body: unknown = {}) => {
    const res = await post("/api/v1/backups", tok.root, body);
    expect(res.status).toBe(201);
    return res.body;
  };

  beforeEach(async () => {
    await resetDb();
    // resetDb truncates `users` CASCADE, which also clears the backup_settings
    // singleton (its updated_by FK references users). Re-seed it to a known
    // baseline (retention off, schedule off) so each test is isolated.
    await query(
      `INSERT INTO backup_settings (id, retention_count, schedule_enabled, schedule_frequency, schedule_run_time, next_run_at)
       VALUES (1, NULL, false, 'daily', '02:00', NULL)
       ON CONFLICT (id) DO UPDATE SET retention_count = NULL, schedule_enabled = false,
         schedule_frequency = 'daily', schedule_run_time = '02:00', next_run_at = NULL`
    );
    instA = await createInstitution("BKP");
    await createUser({ email: "root@b.dev", password: PW, role: "super_admin", institutionId: null });
    tok.root = await tokenFor("root@b.dev", PW);
    await createUser({ email: "admin@b.dev", password: PW, role: "admin", institutionId: instA });
    tok.admin = await tokenFor("admin@b.dev", PW);
  });

  it("creates a manual global backup with metadata (no storage path exposed)", async () => {
    const b = await makeBackup({ scope: "global" });
    expect(b.scope).toBe("global");
    expect(b.status).toBe("success");
    expect(b.trigger).toBe("manual");
    expect(b.tableCount).toBeGreaterThan(0);
    expect(b.rowCount).toBeGreaterThan(0); // institutions/users at minimum
    expect(Number(b.sizeBytes)).toBeGreaterThan(0); // bigint serialises as a string
    expect(b.schemaVersion).toBeGreaterThan(0);
    expect(b.hasArtifact).toBe(true);
    // The raw object key / storage path is never returned.
    expect(JSON.stringify(b)).not.toMatch(/storageKey|storage_key/i);
    expect(JSON.stringify(b)).not.toContain("backups/");
  });

  it("lists backups and a single backup without leaking storage paths", async () => {
    const b = await makeBackup();
    const list = await get("/api/v1/backups", tok.root);
    expect(list.status).toBe(200);
    expect(list.body.some((x: { id: string }) => x.id === b.id)).toBe(true);
    const one = await get(`/api/v1/backups/${b.id}`, tok.root);
    expect(one.status).toBe(200);
    for (const res of [list, one]) {
      expect(JSON.stringify(res.body)).not.toMatch(/storageKey|storage_key/i);
      expect(JSON.stringify(res.body)).not.toContain("backups/");
    }
  });

  it("downloads a backup artifact through the protected route", async () => {
    const b = await makeBackup();
    const res = await get(`/api/v1/backups/${b.id}/download`, tok.root).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/gzip");
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="backup-.*\.json\.gz"/);
    // The attachment name carries no internal storage path.
    expect(res.headers["content-disposition"]).not.toContain("backups/");
  });

  it("denies every backup endpoint to non-super-admins", async () => {
    const b = await makeBackup();
    expect((await get("/api/v1/backups", tok.admin)).status).toBe(403);
    expect((await post("/api/v1/backups", tok.admin, {})).status).toBe(403);
    expect((await get(`/api/v1/backups/${b.id}/download`, tok.admin)).status).toBe(403);
    expect((await get(`/api/v1/backups/${b.id}/restore/preview`, tok.admin)).status).toBe(403);
    expect((await post(`/api/v1/backups/${b.id}/restore`, tok.admin, { confirm: true })).status).toBe(403);
    expect((await patch("/api/v1/backups/settings", tok.admin, { retentionCount: 1 })).status).toBe(403);
  });

  it("requires explicit confirmation before a restore", async () => {
    const b = await makeBackup();
    expect((await post(`/api/v1/backups/${b.id}/restore`, tok.root, {})).status).toBe(400);
    expect((await post(`/api/v1/backups/${b.id}/restore`, tok.root, { confirm: false })).status).toBe(400);
  });

  it("previews a restore without applying it", async () => {
    const b = await makeBackup();
    const res = await get(`/api/v1/backups/${b.id}/restore/preview`, tok.root);
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe("global");
    expect(res.body.schemaMatches).toBe(true);
    expect(res.body.restorable).toBe(true);
    expect(res.body.tableCount).toBeGreaterThan(0);
    expect(Array.isArray(res.body.tables)).toBe(true);
  });

  it("restores the database from a confirmed global backup", async () => {
    const before = Number((await query("SELECT count(*)::int AS n FROM institutions")).rows[0].n);
    const b = await makeBackup();
    const res = await post(`/api/v1/backups/${b.id}/restore`, tok.root, { confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.restored).toBe(true);
    expect(res.body.rowCount).toBeGreaterThan(0);
    // Data is intact and auth/permissions survived the reload.
    const after = Number((await query("SELECT count(*)::int AS n FROM institutions")).rows[0].n);
    expect(after).toBe(before);
    expect((await get("/api/v1/backups", tok.root)).status).toBe(200);
    // The restore attempt is durably audited.
    const audit = await get("/api/v1/platform/audit?action=restore.success", tok.root);
    expect(audit.body.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects restoring an institution-scoped backup", async () => {
    const b = await makeBackup({ scope: "institution", institutionId: instA });
    expect(b.scope).toBe("institution");
    const res = await post(`/api/v1/backups/${b.id}/restore`, tok.root, { confirm: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/global/i);
  });

  it("applies retention to keep only the latest N global backups", async () => {
    expect((await patch("/api/v1/backups/settings", tok.root, { retentionCount: 1 })).status).toBe(200);
    const first = await makeBackup();
    await makeBackup();
    const list = await get("/api/v1/backups?scope=global", tok.root);
    expect(list.body).toHaveLength(1); // older one pruned
    expect(list.body.some((x: { id: string }) => x.id === first.id)).toBe(false);
  });

  it("never deletes backups when retention is unset", async () => {
    await makeBackup();
    await makeBackup();
    const list = await get("/api/v1/backups?scope=global", tok.root);
    expect(list.body.length).toBe(2);
  });

  it("registers and runs a scheduled backup when due", async () => {
    await patch("/api/v1/backups/settings", tok.root, {
      scheduleEnabled: true,
      scheduleFrequency: "daily",
      scheduleRunTime: "00:00",
    });
    // Force the next run into the past so the tick sees it as due.
    await query("UPDATE backup_settings SET next_run_at = now() - interval '1 hour' WHERE id = 1");

    const result = await enqueueDueScheduledBackups();
    expect(result.enqueued).toBe(1);
    const jobs = await query("SELECT * FROM jobs WHERE type = 'scheduled_backup'");
    expect(jobs.rows.length).toBe(1);

    await processDueJobs();
    const done = await query(
      "SELECT * FROM backups WHERE scope = 'global' AND trigger = 'scheduled' AND status = 'success'"
    );
    expect(done.rows.length).toBe(1);
  });

  it("writes a durable audit entry for a backup", async () => {
    await makeBackup();
    const audit = await get("/api/v1/platform/audit?action=backup.create", tok.root);
    expect(audit.status).toBe(200);
    expect(audit.body.length).toBeGreaterThanOrEqual(1);
    expect(audit.body[0].targetType).toBe("backup");
  });

  it("exposes backup/restore metrics and overview without secrets", async () => {
    await makeBackup();
    const metrics = await get("/api/v1/observability/metrics", tok.root);
    expect(metrics.status).toBe(200);
    expect(metrics.text).toContain("backups_total");
    expect(metrics.text).toContain("restores_total");
    expect(metrics.text).toContain("backups_stored");
    expect(metrics.text).toContain("backup_last_success_timestamp_seconds");
    expect(metrics.text).not.toMatch(/password|secret|token/i);

    const overview = await get("/api/v1/observability/overview", tok.root);
    expect(overview.body.backups).toBeDefined();
    expect(overview.body.backups.success).toBeGreaterThanOrEqual(1);
    expect(overview.body.backups.stored).toBeGreaterThanOrEqual(1);
    expect(overview.body.backups.lastSuccessAt).toBeTruthy();
  });

  it("validates an institution-scoped backup requires an institution id", async () => {
    expect((await post("/api/v1/backups", tok.root, { scope: "institution" })).status).toBe(400);
  });
});
