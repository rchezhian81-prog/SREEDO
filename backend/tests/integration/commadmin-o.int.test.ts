import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";
import { processDueJobs } from "../../src/modules/jobs/jobs.worker";

const PW = "Passw0rd!";
// A sentinel secret seeded into a delivery failure reason — it (and its gateway
// webhook prefix) must NEVER reach any list / detail / export response.
const SENTINEL = "SUPERSECRETVALUE1234567890";
const SECRET_RE = new RegExp(`${SENTINEL}|whsec_|sk_live|smtpPass|smtpUser|password_hash`, "i");

describe("Super Admin O — Communication Admin", () => {
  const tok: Record<string, string> = {};
  let inst: string;
  const ids: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, body?: unknown) =>
    request(app).post(p).set(auth(t)).send(body as object);
  const patch = (p: string, t: string, body?: unknown) =>
    request(app).patch(p).set(auth(t)).send(body as object);
  const del = (p: string, t: string) => request(app).delete(p).set(auth(t));

  async function auditCount(action: string): Promise<number> {
    const { rows } = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM platform_audit_log WHERE action = $1`,
      [action]
    );
    return Number(rows[0].n);
  }

  async function seedTemplate(
    key: string,
    opts: { name?: string; category?: string; subject?: string; bodyText?: string; status?: string; builtin?: boolean } = {}
  ): Promise<string> {
    const subject = opts.subject ?? "{{platformName}} — {{userName}}";
    const bodyText = opts.bodyText ?? "Hi {{userName}}, {{securitySummary}}";
    const status = opts.status ?? "active";
    const { rows } = await query<{ id: string }>(
      `INSERT INTO email_templates (key, name, category, subject, body_text, status, version, is_builtin, description)
       VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8) RETURNING id`,
      [key, opts.name ?? key, opts.category ?? "general", subject, bodyText, status, opts.builtin ?? true, null]
    );
    await query(
      `INSERT INTO email_template_versions (template_id, key, version, subject, body_text, status, change_note)
       VALUES ($1,$2,1,$3,$4,$5,'Initial built-in version')`,
      [rows[0].id, key, subject, bodyText, status]
    );
    return rows[0].id;
  }

  beforeEach(async () => {
    await resetDb();
    // The comm-settings singleton is O-only and truncated by resetDb — re-seed it.
    await query(
      `INSERT INTO platform_comm_settings (id, categories)
       VALUES (1, '{"invoice":true,"subscription":true,"support":true,"security":true,"backup":true,"export":true,"platform_admin":true,"broadcast":true}'::jsonb)
       ON CONFLICT (id) DO UPDATE SET categories = EXCLUDED.categories, updated_by = NULL`
    );

    await createUser({ email: "root@o.dev", password: PW, role: "super_admin", institutionId: null });
    tok.root = await tokenFor("root@o.dev", PW);
    inst = await createInstitution("OCOM", "school");
    await createUser({ email: "admin@o.dev", password: PW, role: "admin", institutionId: inst, fullName: "Tenant Admin" });
    tok.tenant = await tokenFor("admin@o.dev", PW);
    await createUser({ email: "stud@o.dev", password: PW, role: "student", institutionId: inst });
    tok.user = await tokenFor("stud@o.dev", PW);

    // Templates (built-ins are re-seeded per test; the migration seeds are truncated).
    await seedTemplate("invoice_issued", {
      name: "Invoice issued",
      category: "billing",
      subject: "Invoice {{invoiceNumber}} from {{platformName}}",
      bodyText: "Hi {{userName}}, pay {{paymentLink}} — ref {{bogusVar}}",
    });
    await seedTemplate("security_notification", { name: "Security notice", category: "security" });

    // A couple of platform deliveries — one sent, one FAILED with a secret-shaped
    // failure reason that must be masked everywhere.
    ids.d1 = (
      await query<{ id: string }>(
        `INSERT INTO email_deliveries (template_key, category, subject, recipient, institution_id, trigger_source, status, provider_response, sent_at)
         VALUES ('security_notification','support','Support started','ops@sreedo.io',$1,'support','sent','Accepted by SMTP server', now())
         RETURNING id`,
        [inst]
      )
    ).rows[0].id;
    ids.d2 = (
      await query<{ id: string }>(
        `INSERT INTO email_deliveries (template_key, category, subject, recipient, institution_id, trigger_source, status, failure_reason, provider_response)
         VALUES ('invoice_issued','subscription','Subscription expired','billing@acme.co',$1,'subscription','failed',$2,'SMTP send failed')
         RETURNING id`,
        [inst, `SMTP auth error: whsec_${SENTINEL} was rejected`]
      )
    ).rows[0].id;

    // A legacy invoice_emails row (surfaced READ-ONLY as a unified-log source).
    const invId = (
      await query<{ id: string }>(
        `INSERT INTO saas_invoices (institution_id, number, status) VALUES ($1,'SINV-TEST-0001','issued') RETURNING id`,
        [inst]
      )
    ).rows[0].id;
    ids.legacy = (
      await query<{ id: string }>(
        `INSERT INTO invoice_emails (invoice_id, recipient, template, status, error)
         VALUES ($1,'legacy@acme.co','invoice_issued','failed','mailbox full') RETURNING id`,
        [invId]
      )
    ).rows[0].id;
  });

  // ---- Dashboard + provider ------------------------------------------------

  it("serves the dashboard with the metric cards and no secrets", async () => {
    const res = await get("/api/v1/comm-admin/summary", tok.root);
    expect(res.status).toBe(200);
    expect(res.body.provider).toBeDefined();
    expect(res.body.templates.total).toBeGreaterThanOrEqual(2);
    expect(res.body.emails).toBeDefined();
    expect(res.body.broadcasts).toBeDefined();
    expect(res.body.bySource).toBeDefined();
    expect(res.body.bySource.invoice).toBeGreaterThanOrEqual(1); // legacy invoice email
    expect(Array.isArray(res.body.recentFailures)).toBe(true);
    expect(res.body.health).toBeDefined();
    expect(JSON.stringify(res.body)).not.toMatch(SECRET_RE);
  });

  it("exposes SMTP provider status with SAFE fields only (no user/pass/host) + a parsed fromEmail", async () => {
    const res = await get("/api/v1/comm-admin/provider", tok.root);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false); // SMTP unconfigured in tests
    expect(res.body.status).toBe("not_configured");
    expect(res.body.fromEmail).toBe("no-reply@sreedo.edu");
    expect(res.body.fromName).toBeTruthy();
    // NEVER the raw SMTP credentials/host.
    expect(res.body).not.toHaveProperty("smtpUser");
    expect(res.body).not.toHaveProperty("smtpPass");
    expect(res.body).not.toHaveProperty("smtpHost");
    expect(res.body).not.toHaveProperty("host");
    expect(JSON.stringify(res.body)).not.toMatch(SECRET_RE);
  });

  // ---- Templates -----------------------------------------------------------

  it("lists templates and gets one with version history", async () => {
    const list = await get("/api/v1/comm-admin/templates", tok.root);
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThanOrEqual(2);
    expect(list.body.rows.some((r: { key: string }) => r.key === "invoice_issued")).toBe(true);

    const one = await get("/api/v1/comm-admin/templates/invoice_issued", tok.root);
    expect(one.status).toBe(200);
    expect(one.body.key).toBe("invoice_issued");
    expect(one.body.isBuiltin).toBe(true);
    expect(one.body.versions.length).toBeGreaterThanOrEqual(1);
    // 404 for a missing template.
    expect((await get("/api/v1/comm-admin/templates/nope_missing", tok.root)).status).toBe(404);
  });

  it("creates a custom template (is_builtin=false) and audits it", async () => {
    const res = await post("/api/v1/comm-admin/templates", tok.root, {
      key: "welcome_custom",
      name: "Custom welcome",
      category: "general",
      subject: "Welcome {{userName}}",
      bodyText: "Hi {{userName}}, welcome to {{platformName}}.",
    });
    expect(res.status).toBe(201);
    expect(res.body.isBuiltin).toBe(false);
    expect(res.body.version).toBe(1);
    expect(res.body.versions).toHaveLength(1);
    expect(await auditCount("comm.template_created")).toBeGreaterThanOrEqual(1);
    // Duplicate key → 409.
    expect(
      (
        await post("/api/v1/comm-admin/templates", tok.root, {
          key: "welcome_custom",
          name: "Duplicate name",
          subject: "Subject",
          bodyText: "Body",
        })
      ).status
    ).toBe(409);
  });

  it("edits a template — bumps version and snapshots the prior content", async () => {
    const edit = await patch("/api/v1/comm-admin/templates/invoice_issued", tok.root, {
      subject: "Updated invoice {{invoiceNumber}}",
      changeNote: "wording tweak",
    });
    expect(edit.status).toBe(200);
    expect(edit.body.version).toBe(2);

    const versions = await get("/api/v1/comm-admin/templates/invoice_issued/versions", tok.root);
    expect(versions.body.versions.length).toBeGreaterThanOrEqual(2);
    // The prior (v1) content is retained in history.
    const v1 = versions.body.versions.find((v: { version: number }) => v.version === 1);
    expect(v1.subject).toBe("Invoice {{invoiceNumber}} from {{platformName}}");
    expect(await auditCount("comm.template_updated")).toBeGreaterThanOrEqual(1);
  });

  it("publishes/disables a template and never hard-deletes (built-ins protected)", async () => {
    const disabled = await post("/api/v1/comm-admin/templates/invoice_issued/publish", tok.root, {
      status: "disabled",
    });
    expect(disabled.status).toBe(200);
    expect(disabled.body.status).toBe("disabled");
    expect(await auditCount("comm.template_published")).toBeGreaterThanOrEqual(1);

    // No DELETE route exists — the built-in is never removed.
    expect((await del("/api/v1/comm-admin/templates/invoice_issued", tok.root)).status).toBe(404);
    const stillThere = Number(
      (await query<{ n: number }>("SELECT count(*)::int AS n FROM email_templates WHERE key='invoice_issued'")).rows[0].n
    );
    expect(stillThere).toBe(1);
  });

  it("restores a previous template version (writes a new version; audited)", async () => {
    await patch("/api/v1/comm-admin/templates/invoice_issued", tok.root, { subject: "V2 subject" });
    const restore = await post("/api/v1/comm-admin/templates/invoice_issued/restore", tok.root, { version: 1 });
    expect(restore.status).toBe(200);
    expect(restore.body.version).toBe(3); // v1 content re-written as v3
    expect(restore.body.subject).toBe("Invoice {{invoiceNumber}} from {{platformName}}");
    expect(await auditCount("comm.template_restored")).toBeGreaterThanOrEqual(1);
    // Restoring a non-existent version → 404.
    expect((await post("/api/v1/comm-admin/templates/invoice_issued/restore", tok.root, { version: 99 })).status).toBe(404);
  });

  it("previews a template — renders known {{vars}} and flags unknown ones", async () => {
    const res = await post("/api/v1/comm-admin/templates/invoice_issued/preview", tok.root, {
      sampleContext: { invoiceNumber: "INV-42" },
    });
    expect(res.status).toBe(200);
    expect(res.body.subject).toContain("INV-42");
    expect(res.body.subject).toContain("SRE EDU OS"); // {{platformName}} resolved
    // {{bogusVar}} is not in the allowlist → left visible + flagged (never silent).
    expect(res.body.unknownVars).toContain("bogusVar");
    expect(res.body.bodyText).toContain("{{bogusVar}}");
  });

  // ---- Test send -----------------------------------------------------------

  it("sends a test email (logs a manual_test delivery + audited); external recipient requires a reason", async () => {
    const okTest = await post("/api/v1/comm-admin/provider/test", tok.root, { to: "qa+test@example.com" });
    expect(okTest.status).toBe(200);
    expect(okTest.body.status).toMatch(/sent|skipped|failed/);
    const logged = Number(
      (await query<{ n: number }>("SELECT count(*)::int AS n FROM email_deliveries WHERE trigger_source='manual_test'")).rows[0].n
    );
    expect(logged).toBeGreaterThanOrEqual(1);
    expect(await auditCount("comm.test_send")).toBeGreaterThanOrEqual(1);

    // A non-test recipient REQUIRES a reason.
    expect((await post("/api/v1/comm-admin/provider/test", tok.root, { to: "ceo@acme.co" })).status).toBe(400);
    const withReason = await post("/api/v1/comm-admin/provider/test", tok.root, {
      to: "ceo@acme.co",
      reason: "verifying production SMTP delivery",
    });
    expect(withReason.status).toBe(200);
  });

  // ---- Deliveries ----------------------------------------------------------

  it("lists deliveries incl. the legacy invoice_emails source, with filter/paginate/sort", async () => {
    const all = await get("/api/v1/comm-admin/deliveries", tok.root);
    expect(all.status).toBe(200);
    expect(all.body.total).toBeGreaterThanOrEqual(3); // d1 + d2 + legacy
    // The legacy invoice email is surfaced with source/trigger 'invoice'.
    const legacy = all.body.rows.find((r: { source: string }) => r.source === "invoice");
    expect(legacy).toBeDefined();
    expect(legacy.triggerSource).toBe("invoice");

    // Filter by trigger source.
    const support = await get("/api/v1/comm-admin/deliveries?triggerSource=support", tok.root);
    expect(support.body.rows.every((r: { triggerSource: string }) => r.triggerSource === "support")).toBe(true);

    // Paginate + sort (must not error).
    const page = await get("/api/v1/comm-admin/deliveries?page=1&pageSize=1&sort=status&order=asc", tok.root);
    expect(page.body.rows.length).toBeLessThanOrEqual(1);
    expect(page.body.pageSize).toBe(1);
    expect(JSON.stringify(all.body)).not.toMatch(SECRET_RE);
  });

  it("returns a masked delivery detail (secret failure reason never leaks)", async () => {
    const res = await get(`/api/v1/comm-admin/deliveries/${ids.d2}`, tok.root);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("failed");
    expect(typeof res.body.failureReason).toBe("string");
    expect(JSON.stringify(res.body)).not.toMatch(SECRET_RE);
    // 404 for a missing id.
    expect((await get("/api/v1/comm-admin/deliveries/00000000-0000-0000-0000-000000000000", tok.root)).status).toBe(404);
  });

  it("retries a FAILED delivery; refuses a non-failed and the read-only legacy source", async () => {
    const retry = await post(`/api/v1/comm-admin/deliveries/${ids.d2}/retry`, tok.root, { reason: "transient bounce" });
    expect(retry.status).toBe(200);
    expect(retry.body.retried).toBe(true);
    expect(await auditCount("comm.delivery_retried")).toBeGreaterThanOrEqual(1);

    // A sent delivery cannot be retried.
    expect((await post(`/api/v1/comm-admin/deliveries/${ids.d1}/retry`, tok.root, {})).status).toBe(400);
    // The legacy invoice_emails row is read-only.
    const legacy = await post(`/api/v1/comm-admin/deliveries/${ids.legacy}/retry`, tok.root, {});
    expect(legacy.status).toBe(400);
    expect(legacy.body.error).toMatch(/read-only|legacy/i);
  });

  it("gates the delivery export on a reason and masks every cell", async () => {
    // No reason → 400.
    expect((await get("/api/v1/comm-admin/deliveries/export", tok.root)).status).toBe(400);
    const csv = await get("/api/v1/comm-admin/deliveries/export?reason=audit%20review%20export", tok.root).buffer(true);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.text).not.toMatch(SECRET_RE);
    expect(await auditCount("comm.deliveries_exported")).toBeGreaterThanOrEqual(1);
  });

  // ---- Broadcasts ----------------------------------------------------------

  it("creates a draft broadcast, edits it, previews the audience, schedules and cancels it", async () => {
    const created = await post("/api/v1/comm-admin/broadcasts", tok.root, {
      title: "Planned maintenance",
      bodyText: "Hi {{userName}}, maintenance is planned.",
      audience: "specific_tenant",
      audienceFilter: { institutionId: inst },
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("draft");
    const id = created.body.id;

    const edit = await patch(`/api/v1/comm-admin/broadcasts/${id}`, tok.root, { title: "Planned maintenance (updated)" });
    expect(edit.body.title).toBe("Planned maintenance (updated)");

    const preview = await post(`/api/v1/comm-admin/broadcasts/${id}/preview-audience`, tok.root, {});
    expect(preview.status).toBe(200);
    expect(preview.body.recipientCount).toBe(1); // the single tenant admin
    expect(preview.body.broad).toBe(false);

    const scheduled = await post(`/api/v1/comm-admin/broadcasts/${id}/schedule`, tok.root, {
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(scheduled.body.status).toBe("scheduled");
    expect(await auditCount("comm.broadcast_scheduled")).toBeGreaterThanOrEqual(1);

    const cancelled = await post(`/api/v1/comm-admin/broadcasts/${id}/cancel`, tok.root, { reason: "no longer needed" });
    expect(cancelled.body.status).toBe("cancelled");
    // A cancelled broadcast can no longer be sent.
    expect((await post(`/api/v1/comm-admin/broadcasts/${id}/send`, tok.root, { reason: "too late now" })).status).toBe(400);
  });

  it("requires a reason to send to a broad audience (400 without) and raises a security event", async () => {
    const b = await post("/api/v1/comm-admin/broadcasts", tok.root, {
      title: "All-tenant notice",
      bodyText: "Hello everyone",
      audience: "all_tenants",
    });
    const id = b.body.id;
    // Broad audience without a reason → 400.
    expect((await post(`/api/v1/comm-admin/broadcasts/${id}/send`, tok.root, {})).status).toBe(400);

    const sent = await post(`/api/v1/comm-admin/broadcasts/${id}/send`, tok.root, {
      reason: "platform-wide maintenance announcement",
    });
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe("sending");
    expect(await auditCount("comm.broadcast_sent")).toBeGreaterThanOrEqual(1);
    // A broad send also writes a security event (same action, security-audit path).
    const secEvents = Number(
      (
        await query<{ n: number }>(
          `SELECT count(*)::int AS n FROM platform_audit_log WHERE action='comm.broadcast_sent' AND target_id::text = $1`,
          [id]
        )
      ).rows[0].n
    );
    expect(secEvents).toBeGreaterThanOrEqual(2); // recordAudit + recordSecurityEvent
  });

  it("the broadcast_send worker handler logs deliveries and updates counts/status", async () => {
    const b = await post("/api/v1/comm-admin/broadcasts", tok.root, {
      title: "Tenant notice",
      bodyText: "Hi {{userName}}, please note.",
      audience: "specific_tenant",
      audienceFilter: { institutionId: inst },
    });
    const id = b.body.id;
    const sent = await post(`/api/v1/comm-admin/broadcasts/${id}/send`, tok.root, {});
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe("sending");

    // A broadcast_send job was enqueued.
    const jobs = await query("SELECT * FROM jobs WHERE type='broadcast_send'");
    expect(jobs.rows.length).toBe(1);

    // Drain the queue through the real worker.
    const result = await processDueJobs();
    expect(result.processed).toBeGreaterThanOrEqual(1);

    // One delivery was logged for the broadcast, and the broadcast is now 'sent'.
    const delivered = Number(
      (await query<{ n: number }>("SELECT count(*)::int AS n FROM email_deliveries WHERE broadcast_id = $1", [id])).rows[0].n
    );
    expect(delivered).toBe(1);
    const done = await get(`/api/v1/comm-admin/broadcasts/${id}`, tok.root);
    expect(done.body.status).toBe("sent");
    expect(done.body.recipientCount).toBe(1);
  });

  // ---- Preferences ---------------------------------------------------------

  it("reads and updates notification preferences; disabling security warns + audits + raises a security event", async () => {
    const read = await get("/api/v1/comm-admin/preferences", tok.root);
    expect(read.status).toBe(200);
    expect(read.body.categories.security).toBe(true);

    const upd = await patch("/api/v1/comm-admin/preferences", tok.root, { categories: { security: false } });
    expect(upd.status).toBe(200);
    expect(upd.body.categories.security).toBe(false);
    expect(upd.body.warning).toBeTruthy(); // never silently disabled
    expect(await auditCount("comm.preferences_updated")).toBeGreaterThanOrEqual(1);
    expect(await auditCount("comm.security_notifications_disabled")).toBeGreaterThanOrEqual(1);
  });

  // ---- Reports -------------------------------------------------------------

  it("produces communication report aggregates", async () => {
    const res = await get("/api/v1/comm-admin/reports?window=30d", tok.root);
    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
    expect(Array.isArray(res.body.byTemplate)).toBe(true);
    expect(Array.isArray(res.body.bySource)).toBe(true);
    expect(res.body.broadcasts).toBeDefined();

    // Report export is reason-gated.
    expect((await get("/api/v1/comm-admin/reports/export", tok.root)).status).toBe(400);
    const csv = await get("/api/v1/comm-admin/reports/export?reason=monthly%20comms%20report", tok.root).buffer(true);
    expect(csv.status).toBe(200);
    expect(await auditCount("comm.reports_exported")).toBeGreaterThanOrEqual(1);
  });

  it("returns an integrations summary (links only, no secrets)", async () => {
    const res = await get("/api/v1/comm-admin/integrations", tok.root);
    expect(res.status).toBe(200);
    expect(res.body.smtp).toBeDefined();
    expect(res.body.jobs).toBeDefined();
    expect(res.body.links).toBeDefined();
    expect(JSON.stringify(res.body)).not.toMatch(SECRET_RE);
  });

  // ---- RBAC + audit --------------------------------------------------------

  it("blocks tenant admins and plain users from the whole /comm-admin surface (403)", async () => {
    for (const t of [tok.tenant, tok.user]) {
      expect((await get("/api/v1/comm-admin/summary", t)).status).toBe(403);
      expect((await get("/api/v1/comm-admin/provider", t)).status).toBe(403);
      expect((await get("/api/v1/comm-admin/templates", t)).status).toBe(403);
      expect((await get("/api/v1/comm-admin/deliveries", t)).status).toBe(403);
      expect((await get("/api/v1/comm-admin/broadcasts", t)).status).toBe(403);
      expect((await get("/api/v1/comm-admin/reports", t)).status).toBe(403);
      expect((await post("/api/v1/comm-admin/provider/test", t, { to: "qa+test@example.com" })).status).toBe(403);
      expect(
        (await post("/api/v1/comm-admin/broadcasts", t, { title: "x", audience: "platform_admins" })).status
      ).toBe(403);
      expect((await get("/api/v1/comm-admin/deliveries/export?reason=trying%20to%20export", t)).status).toBe(403);
    }
  });

  it("audits a mutating action to platform_audit_log", async () => {
    expect(await auditCount("comm.test_send")).toBe(0);
    await post("/api/v1/comm-admin/provider/test", tok.root, { to: "qa+test@example.com" });
    expect(await auditCount("comm.test_send")).toBeGreaterThanOrEqual(1);
  });
});
