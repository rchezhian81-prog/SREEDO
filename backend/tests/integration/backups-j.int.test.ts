import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createUser, query, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";

/** Super Admin J — Backup / Restore / DR hardening. */
describe("Super Admin J — backup & restore hardening", () => {
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, body?: unknown) =>
    request(app).post(p).set(auth(t)).send(body as object);
  const patch = (p: string, t: string, body?: unknown) =>
    request(app).patch(p).set(auth(t)).send(body as object);
  const makeBackup = async () => {
    const res = await post("/api/v1/backups", tok.root, { scope: "global" });
    expect(res.status).toBe(201);
    return res.body;
  };

  beforeEach(async () => {
    await resetDb();
    // backup_settings + backup_dr_guide are singletons (not truncated by resetDb) —
    // reset to a known baseline so each test is isolated.
    await query(
      `INSERT INTO backup_settings (id) VALUES (1)
       ON CONFLICT (id) DO UPDATE SET retention_count=NULL, retention_min_keep=1,
         schedule_enabled=false, offsite_enabled=false, encryption_enabled=false,
         failure_alert_enabled=true, alert_emails=NULL, last_offsite_test_at=NULL,
         last_offsite_test_ok=NULL, last_offsite_test_detail=NULL`
    );
    await createUser({ email: "root@b.dev", password: PW, role: "super_admin", institutionId: null });
    tok.root = await tokenFor("root@b.dev", PW);
    await createUser({ email: "root2@b.dev", password: PW, role: "super_admin", institutionId: null });
    tok.root2 = await tokenFor("root2@b.dev", PW);
  });

  it("serves the dashboard summary with cards + health warnings and no secrets", async () => {
    await makeBackup();
    const res = await get("/api/v1/backups/summary", tok.root);
    expect(res.status).toBe(200);
    expect(res.body.totals.available).toBeGreaterThanOrEqual(1);
    expect(res.body.integrity.checksumVerified).toBeGreaterThanOrEqual(1);
    expect(res.body.offsite).toBeDefined();
    expect(res.body.encryption.enabled).toBe(false);
    expect(Array.isArray(res.body.warnings)).toBe(true);
    // Encryption-disabled + offsite-not-configured warnings surface honestly.
    expect(res.body.warnings.join(" ")).toMatch(/encryption/i);
    expect(JSON.stringify(res.body)).not.toMatch(/storageKey|storage_key|secret|password|accessKey/i);
  });

  it("paginates + filters backup history and exports masked CSV / XLSX", async () => {
    await makeBackup();
    await makeBackup();
    const hist = await get("/api/v1/backups/history?trigger=manual&pageSize=1&page=1", tok.root);
    expect(hist.status).toBe(200);
    expect(hist.body.total).toBeGreaterThanOrEqual(2);
    expect(hist.body.rows).toHaveLength(1);

    const csv = await get("/api/v1/backups/history/export?format=csv&reason=audit-review", tok.root).buffer(true);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).not.toMatch(/storage_key|backups\//);

    const xlsx = await get("/api/v1/backups/history/export?format=xlsx&reason=audit-review", tok.root).buffer(true);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers["content-type"]).toContain("spreadsheet");
    // XLSX is a zip (PK magic).
    expect(xlsx.body.slice(0, 2).toString()).toBe("PK");

    // The export is audited.
    const audit = await get("/api/v1/platform/audit?action=backup.history_exported", tok.root);
    expect(audit.body.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("verifies checksums; a tampered checksum flips to failed and blocks restore execution", async () => {
    const b = await makeBackup();
    const ok = await post(`/api/v1/backups/${b.id}/verify`, tok.root);
    expect(ok.status).toBe(200);
    expect(ok.body.verified).toBe(true);

    // Simulate corruption: the recorded checksum no longer matches the artifact.
    await query("UPDATE backups SET checksum = 'deadbeef' WHERE id = $1", [b.id]);
    const bad = await post(`/api/v1/backups/${b.id}/verify`, tok.root);
    expect(bad.body.verified).toBe(false);
    expect(bad.body.checksumStatus).toBe("failed");

    // A failed-checksum backup cannot be restored (request → approve → execute is blocked).
    const req = await post(`/api/v1/backups/${b.id}/restore-requests`, tok.root, { reason: "attempt restore corrupt" });
    expect(req.status).toBe(201);
    await post(`/api/v1/backups/restore-requests/${req.body.id}/decide`, tok.root2, {
      decision: "approved",
      reason: "approve for test",
    });
    const exec = await post(`/api/v1/backups/restore-requests/${req.body.id}/execute`, tok.root, {
      confirmText: req.body.confirmPhrase,
      reason: "execute corrupt",
    });
    expect(exec.status).toBe(400);
    expect(exec.body.error).toMatch(/checksum/i);
  });

  it("archives softly (metadata retained) and refuses the latest successful backup without override", async () => {
    const b1 = await makeBackup();
    // b1 is the only successful backup → it is the rollback window → refuse.
    const refuse = await post(`/api/v1/backups/${b1.id}/archive`, tok.root, { reason: "cleanup" });
    expect(refuse.status).toBe(400);
    expect(refuse.body.error).toMatch(/latest|rollback/i);

    const b2 = await makeBackup(); // now b2 is latest; b1 leaves the window
    const arch = await post(`/api/v1/backups/${b1.id}/archive`, tok.root, { reason: "old snapshot cleanup" });
    expect(arch.status).toBe(200);
    const b1row = await get(`/api/v1/backups/${b1.id}`, tok.root);
    expect(b1row.body.status).toBe("archived");
    expect(b1row.body.hasArtifact).toBe(false); // artifact removed, metadata kept

    // The latest (b2) still needs an explicit override.
    expect((await post(`/api/v1/backups/${b2.id}/archive`, tok.root, { reason: "x" })).status).toBe(400);
    expect(
      (await post(`/api/v1/backups/${b2.id}/archive`, tok.root, { reason: "override cleanup", override: true }))
        .status
    ).toBe(200);
  });

  it("requires a reason to download a backup and audits it", async () => {
    const b = await makeBackup();
    expect((await get(`/api/v1/backups/${b.id}/download`, tok.root)).status).toBe(400);
    const dl = await get(`/api/v1/backups/${b.id}/download?reason=quarterly-dr-drill`, tok.root).buffer(true);
    expect(dl.status).toBe(200);
    const audit = await get("/api/v1/platform/audit?action=backup.download", tok.root);
    expect(audit.body.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("reports offsite status masked (no keys) and records a connectivity test", async () => {
    const status = await get("/api/v1/backups/offsite", tok.root);
    expect(status.status).toBe(200);
    expect(["s3", "local"]).toContain(status.body.mode);
    expect(JSON.stringify(status.body)).not.toMatch(/accessKey|secretKey|password|storage_key/i);

    const test = await post("/api/v1/backups/offsite/test", tok.root);
    expect(test.status).toBe(200);
    expect(typeof test.body.ok).toBe("boolean");
    const audit = await get("/api/v1/platform/audit?action=backup.offsite_test", tok.root);
    expect(audit.body.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("reports encryption status honestly (documented limitation, not faked)", async () => {
    const res = await get("/api/v1/backups/encryption", tok.root);
    expect(res.status).toBe(200);
    expect(res.body.implemented).toBe(false);
    expect(res.body.status).toBe("not_enabled");
    expect(res.body.warning).toMatch(/not implemented|not encrypted/i);
  });

  it("loads and updates the disaster-recovery guide", async () => {
    const before = await get("/api/v1/backups/dr-guide", tok.root);
    expect(before.status).toBe(200);
    expect(before.body.restoreProcess).toBeTruthy(); // seeded default

    const upd = await patch("/api/v1/backups/dr-guide", tok.root, {
      ownerName: "Platform SRE",
      ownerContact: "sre@example.com",
      markReviewed: true,
    });
    expect(upd.status).toBe(200);
    expect(upd.body.ownerName).toBe("Platform SRE");
    expect(upd.body.lastReviewedAt).toBeTruthy();
    const audit = await get("/api/v1/platform/audit?action=backup.dr_guide_update", tok.root);
    expect(audit.body.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects a restore request and refuses to execute a rejected request", async () => {
    const b = await makeBackup();
    const req = await post(`/api/v1/backups/${b.id}/restore-requests`, tok.root, { reason: "please restore" });
    expect(req.status).toBe(201);
    const rej = await post(`/api/v1/backups/restore-requests/${req.body.id}/decide`, tok.root2, {
      decision: "rejected",
      reason: "not approved right now",
    });
    expect(rej.status).toBe(200);
    expect(rej.body.status).toBe("rejected");
    const exec = await post(`/api/v1/backups/restore-requests/${req.body.id}/execute`, tok.root, {
      confirmText: req.body.confirmPhrase,
      reason: "trying anyway",
    });
    expect(exec.status).toBe(400);
    expect(exec.body.error).toMatch(/approved/i);
  });

  it("enforces single-use of an approved restore request", async () => {
    const b = await makeBackup();
    const req = await post(`/api/v1/backups/${b.id}/restore-requests`, tok.root, { reason: "single use test" });
    await post(`/api/v1/backups/restore-requests/${req.body.id}/decide`, tok.root2, {
      decision: "approved",
      reason: "approved once",
    });
    // Simulate the approval already having been spent.
    await query("UPDATE restore_requests SET consumed_at = now() WHERE id = $1", [req.body.id]);
    const exec = await post(`/api/v1/backups/restore-requests/${req.body.id}/execute`, tok.root, {
      confirmText: req.body.confirmPhrase,
      reason: "second use",
    });
    expect(exec.status).toBe(409);
  });

  it("test-restore is a read-only dry-run that does not modify data", async () => {
    const before = Number((await query("SELECT count(*)::int AS n FROM users")).rows[0].n);
    const b = await makeBackup();
    const res = await post(`/api/v1/backups/${b.id}/test-restore`, tok.root);
    expect(res.status).toBe(200);
    expect(res.body.decoded).toBe(true);
    expect(res.body.restorable).toBe(true);
    // No data changed.
    const after = Number((await query("SELECT count(*)::int AS n FROM users")).rows[0].n);
    expect(after).toBe(before);
    const audit = await get("/api/v1/platform/audit?action=restore.test", tok.root);
    expect(audit.body.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("never exposes storage secrets in settings or summary", async () => {
    await makeBackup();
    for (const path of ["/api/v1/backups/settings", "/api/v1/backups/summary", "/api/v1/backups/offsite"]) {
      const res = await get(path, tok.root);
      expect(JSON.stringify(res.body)).not.toMatch(/storage_key|storageKey|secretKey|accessKey|password/i);
    }
  });
});
