import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";

// Super Admin D — subscription lifecycle control center.

const PW = "Passw0rd!";
const P = "/api/v1/platform/subscriptions";

async function makePackage(name: string, opts: { cycle?: string; price?: number; currency?: string } = {}) {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO subscription_packages (name, price, billing_cycle, currency)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [name, opts.price ?? 12000, opts.cycle ?? "annual", opts.currency ?? "INR"]
  );
  return rows[0].id;
}
async function makeSub(
  institutionId: string, packageId: string,
  opts: { status?: string; endsAt?: string | null; trialEndsAt?: string | null } = {}
) {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO institution_subscriptions (institution_id, package_id, status, starts_at, ends_at, trial_ends_at)
     VALUES ($1, $2, $3, CURRENT_DATE, $4::date, $5::date) RETURNING id`,
    [institutionId, packageId, opts.status ?? "active", opts.endsAt ?? null, opts.trialEndsAt ?? null]
  );
  return rows[0].id;
}
async function makeOverdueInvoice(institutionId: string, packageId: string, total = 5000) {
  await query(
    `INSERT INTO saas_invoices (institution_id, package_id, status, currency, subtotal, tax_amount, total, due_date)
     VALUES ($1, $2, 'issued', 'INR', $3, 0, $3, CURRENT_DATE - 5)`,
    [institutionId, packageId, total]
  );
}

describe("Super Admin D — subscription management", () => {
  let inst: string;
  let inst2: string;
  let pkg: string;
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, b?: unknown) => request(app).post(p).set(auth(t)).send(b ?? {});
  const put = (p: string, t: string, b: unknown) => request(app).put(p).set(auth(t)).send(b);
  const patch = (p: string, t: string, b: unknown) => request(app).patch(p).set(auth(t)).send(b);
  const del = (p: string, t: string) => request(app).delete(p).set(auth(t));

  beforeEach(async () => {
    await resetDb();
    inst = await createInstitution("SUBD", "school");
    inst2 = await createInstitution("SUBD2", "college");
    pkg = await makePackage("Standard D");
    await createUser({ email: "super@d.dev", password: PW, role: "super_admin", institutionId: null });
    await createUser({ email: "admin@d.dev", password: PW, role: "admin", institutionId: inst });
    tok.super = await tokenFor("super@d.dev", PW);
    tok.admin = await tokenFor("admin@d.dev", PW);
  });

  it("blocks non-super-admins from the whole surface", async () => {
    expect((await get(`${P}/summary`, tok.admin)).status).toBe(403);
    expect((await get(`${P}/list`, tok.admin)).status).toBe(403);
  });

  it("summarises subscriptions by status + revenue", async () => {
    await makeSub(inst, pkg, { status: "active", endsAt: "2999-01-01" });
    await makeSub(inst2, pkg, { status: "trialing", trialEndsAt: "2999-01-01" });
    const r = await get(`${P}/summary`, tok.super);
    expect(r.status).toBe(200);
    expect(r.body.counts.total).toBe(2);
    expect(r.body.counts.active).toBe(1);
    expect(r.body.counts.trialing).toBe(1);
    expect(r.body.revenue).toHaveProperty("mrr");
    expect(r.body.revenue).toHaveProperty("outstanding");
  });

  it("lists with search, status filter, sorting and pagination", async () => {
    await makeSub(inst, pkg, { status: "active", endsAt: "2999-01-01" });
    await makeSub(inst2, pkg, { status: "expired", endsAt: "2000-01-01" });
    const all = await get(`${P}/list`, tok.super);
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(2);

    const filtered = await get(`${P}/list?status=expired`, tok.super);
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.rows[0].status).toBe("expired");

    const searched = await get(`${P}/list?q=SUBD2`, tok.super);
    expect(searched.body.rows.every((r: { institutionCode: string }) => r.institutionCode === "SUBD2")).toBe(true);

    const paged = await get(`${P}/list?pageSize=1&page=1`, tok.super);
    expect(paged.body.rows).toHaveLength(1);
    expect(paged.body.total).toBe(2);
  });

  it("returns a full detail with billing, events and notes", async () => {
    const id = await makeSub(inst, pkg, { status: "active", endsAt: "2999-01-01" });
    const r = await get(`${P}/${id}`, tok.super);
    expect(r.status).toBe(200);
    expect(r.body.institutionId).toBe(inst);
    expect(r.body.packageName).toBe("Standard D");
    expect(r.body).toHaveProperty("billing");
    expect(Array.isArray(r.body.events)).toBe(true);
    expect(Array.isArray(r.body.notes)).toBe(true);
  });

  it("updates lifecycle config (audited) and reflects it", async () => {
    const upd = await put(`${P}/config`, tok.super, { graceDays: 21, autoSuspendEnabled: true, renewalReminderDays: [30, 7] });
    expect(upd.status).toBe(200);
    const cfg = await get(`${P}/config`, tok.super);
    expect(cfg.body.graceDays).toBe(21);
    expect(cfg.body.autoSuspendEnabled).toBe(true);
    expect(cfg.body.renewalReminderDays).toEqual([30, 7]);
    // back-compat keys still present for the B1 consumer
    expect(cfg.body).toHaveProperty("autoSuspend", true);
    const audit = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM platform_audit_log WHERE action = 'subscription.config_update'`
    );
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it("previews the lifecycle without writing, then the run applies it (idempotent)", async () => {
    const id = await makeSub(inst, pkg, { status: "active", endsAt: "2000-01-01" }); // long past term+grace
    const preview = await get(`${P}/lifecycle-preview`, tok.super);
    expect(preview.status).toBe(200);
    expect(preview.body.actions.termExpiring).toBeGreaterThanOrEqual(1);
    // preview must not mutate
    const still = await get(`${P}/${id}`, tok.super);
    expect(still.body.status).toBe("active");

    const run1 = await post(`/api/v1/platform/subscriptions/run-lifecycle`, tok.super);
    expect(run1.status).toBe(200);
    expect(run1.body.expired).toBeGreaterThanOrEqual(1);
    const after = await get(`${P}/${id}`, tok.super);
    expect(after.body.status).toBe("expired");

    const run2 = await post(`/api/v1/platform/subscriptions/run-lifecycle`, tok.super);
    expect(run2.body.expired).toBe(0); // idempotent
  });

  it("extends, renews and change-packages a subscription (audited)", async () => {
    const id = await makeSub(inst, pkg, { status: "active", endsAt: "2025-01-01" });
    const ext = await post(`${P}/${id}/extend`, tok.super, { endsAt: "2030-01-01", reason: "goodwill" });
    expect(ext.status).toBe(200);
    expect(ext.body.endsAt).toBe("2030-01-01");

    const renew = await post(`${P}/${id}/renew`, tok.super, { periods: 1 });
    expect(renew.status).toBe(200);
    expect(renew.body.status).toBe("active");

    const pkg2 = await makePackage("Premium D", { price: 24000 });
    const chg = await post(`${P}/${id}/change-package`, tok.super, { packageId: pkg2, reason: "upgrade to premium" });
    expect(chg.status).toBe(200);
    expect(chg.body.packageName).toBe("Premium D");
  });

  it("requires a reason for cancel / suspend / mark-expired / change-package", async () => {
    const id = await makeSub(inst, pkg, { status: "active", endsAt: "2999-01-01" });
    expect((await post(`${P}/${id}/cancel`, tok.super, {})).status).toBe(400);
    expect((await post(`${P}/${id}/suspend`, tok.super, {})).status).toBe(400);
    expect((await post(`${P}/${id}/mark-expired`, tok.super, {})).status).toBe(400);
    expect((await post(`${P}/${id}/change-package`, tok.super, { packageId: pkg })).status).toBe(400);
  });

  it("cancels/suspends/reactivates/marks-expired with audit and never hard-deletes", async () => {
    const id = await makeSub(inst, pkg, { status: "active", endsAt: "2999-01-01" });
    expect((await post(`${P}/${id}/suspend`, tok.super, { reason: "non-payment", suspendTenant: true })).body.status).toBe("suspended");
    // tenant suspension applied
    const tenant = await query<{ is_active: boolean }>(`SELECT is_active FROM institutions WHERE id = $1`, [inst]);
    expect(tenant.rows[0].is_active).toBe(false);

    expect((await post(`${P}/${id}/reactivate`, tok.super, { reason: "paid", reactivateTenant: true })).body.status).toBe("active");
    const tenant2 = await query<{ is_active: boolean }>(`SELECT is_active FROM institutions WHERE id = $1`, [inst]);
    expect(tenant2.rows[0].is_active).toBe(true);

    expect((await post(`${P}/${id}/cancel`, tok.super, { reason: "customer left" })).body.status).toBe("cancelled");
    // row still exists (no hard delete)
    const still = await query<{ n: number }>(`SELECT count(*)::int AS n FROM institution_subscriptions WHERE id = $1`, [id]);
    expect(still.rows[0].n).toBe(1);

    // event trail + audit both recorded for the sensitive actions
    const events = await query<{ n: number }>(`SELECT count(*)::int AS n FROM subscription_events WHERE subscription_id = $1 AND reason IS NOT NULL`, [id]);
    expect(events.rows[0].n).toBeGreaterThanOrEqual(2);
    const audits = await query<{ n: number }>(`SELECT count(*)::int AS n FROM platform_audit_log WHERE target_id = $1`, [id]);
    expect(audits.rows[0].n).toBeGreaterThanOrEqual(3);
  });

  it("serves the renewal calendar", async () => {
    await query(
      `UPDATE institution_subscriptions SET renews_at = CURRENT_DATE + 10 WHERE id = $1`,
      [await makeSub(inst, pkg, { status: "active", endsAt: "2999-01-01" })]
    );
    const cal = await get(`${P}/calendar`, tok.super);
    expect(cal.status).toBe(200);
    expect(cal.body.some((r: { kind: string }) => r.kind === "renewal")).toBe(true);
  });

  it("sends a manual reminder and records history (skipped when SMTP unset)", async () => {
    const id = await makeSub(inst, pkg, { status: "active", endsAt: "2999-01-01" });
    const r = await post(`${P}/${id}/reminder`, tok.super, {});
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("configured");
    const hist = await get(`${P}/${id}/reminders`, tok.super);
    expect(hist.body.length).toBeGreaterThanOrEqual(1);
  });

  it("produces reports and totals", async () => {
    await makeSub(inst, pkg, { status: "active", endsAt: "2999-01-01" });
    await makeSub(inst2, pkg, { status: "active", endsAt: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10) });
    await makeOverdueInvoice(inst, pkg);

    expect((await get(`${P}/reports?key=active`, tok.super)).body.totals.count).toBe(2);
    expect((await get(`${P}/reports?key=expiring&soonDays=30`, tok.super)).body.rows.length).toBeGreaterThanOrEqual(1);
    expect((await get(`${P}/reports?key=package_wise`, tok.super)).body.rows[0].packageName).toBe("Standard D");
    expect((await get(`${P}/reports?key=mrr`, tok.super)).body.totals).toHaveProperty("mrr");
    expect((await get(`${P}/reports?key=overdue`, tok.super)).body.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("exports the list as CSV", async () => {
    await makeSub(inst, pkg, { status: "active", endsAt: "2999-01-01" });
    const r = await get(`${P}/export?format=csv`, tok.super);
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("text/csv");
    expect(r.text).toContain("Institution");
  });

  it("adds, edits and soft-deletes notes (history preserved)", async () => {
    const id = await makeSub(inst, pkg, { status: "active", endsAt: "2999-01-01" });
    const add = await post(`${P}/${id}/notes`, tok.super, { noteType: "renewal", body: "Call before renewal", followUpDate: "2999-01-01" });
    expect(add.status).toBe(200);
    expect(add.body).toHaveLength(1);
    const noteId = (await query<{ id: string }>(`SELECT id FROM subscription_notes WHERE institution_id = $1`, [inst])).rows[0].id;

    const upd = await patch(`${P}/notes/${noteId}`, tok.super, { body: "Updated note" });
    expect(upd.body[0].body).toBe("Updated note");

    const rm = await del(`${P}/notes/${noteId}`, tok.super);
    expect(rm.body).toHaveLength(0); // hidden from the list
    // but the row is retained (soft delete)
    const kept = await query<{ n: number }>(`SELECT count(*)::int AS n FROM subscription_notes WHERE id = $1 AND deleted_at IS NOT NULL`, [noteId]);
    expect(kept.rows[0].n).toBe(1);
  });

  it("lists subscription event history", async () => {
    const id = await makeSub(inst, pkg, { status: "active", endsAt: "2999-01-01" });
    await post(`${P}/${id}/extend`, tok.super, { endsAt: "2031-01-01", reason: "x" });
    const ev = await get(`${P}/${id}/events`, tok.super);
    expect(ev.status).toBe(200);
    expect(ev.body.some((e: { event: string }) => e.event === "extended")).toBe(true);
  });
});
