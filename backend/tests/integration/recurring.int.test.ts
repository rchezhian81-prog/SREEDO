import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";
import { signPayload } from "../../src/modules/saaspayments/saaspayments.service";

/**
 * Billing Phase B4 — online recurring billing + dunning.
 *
 * Covers: graceful no-op when disabled, the dunning retry → exhausted → suspend
 * state machine, a webhook settling a renewal (extend + clear dunning +
 * reactivate), idempotency, bad-signature rejection, and the super-admin guard.
 */

const SUPER = { email: "super@test.dev", password: "Passw0rd!" };
const ADMIN = { email: "admin@test.dev", password: "Passw0rd!" };
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const WH_SECRET = "whsec_recurring_1234";

async function makePackage(cycle = "annual", price = 12000): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO subscription_packages (name, max_students, price, billing_cycle)
     VALUES ('Recurring Plan', 500, $1, $2) RETURNING id`,
    [price, cycle]
  );
  return rows[0].id;
}

/** Create a subscription with explicit recurring/dunning state (test seed). */
async function makeSub(
  institutionId: string,
  packageId: string,
  opts: {
    status?: string;
    renewsExpr?: string; // SQL expression for renews_at / ends_at
    autoRenew?: boolean;
    autoCharge?: boolean;
    dunningState?: string;
    dunningAttempts?: number;
    nextRetryExpr?: string | null; // SQL expression for next_retry_at
  } = {}
): Promise<string> {
  const renews = opts.renewsExpr ?? "CURRENT_DATE + 30";
  const nextRetry = opts.nextRetryExpr === undefined ? "NULL" : opts.nextRetryExpr ?? "NULL";
  const { rows } = await query<{ id: string }>(
    `INSERT INTO institution_subscriptions
       (institution_id, package_id, status, starts_at, ends_at, renews_at,
        auto_renew, auto_charge, dunning_state, dunning_attempts, next_retry_at)
     VALUES ($1, $2, $3, CURRENT_DATE - 300, ${renews}, ${renews},
             $4, $5, $6, $7, ${nextRetry})
     RETURNING id`,
    [
      institutionId,
      packageId,
      opts.status ?? "active",
      opts.autoRenew ?? true,
      opts.autoCharge ?? true,
      opts.dunningState ?? "none",
      opts.dunningAttempts ?? 0,
    ]
  );
  return rows[0].id;
}

/** Seed an ISSUED renewal invoice for an institution (bypasses the API). */
async function makeRenewalInvoice(
  institutionId: string,
  packageId: string,
  opts: { status?: string; number: string; total?: number } = { number: "RENEW-1" }
): Promise<{ id: string; number: string; total: string }> {
  const total = opts.total ?? 12000;
  const { rows } = await query<{ id: string; number: string; total: string }>(
    `INSERT INTO saas_invoices
       (institution_id, package_id, currency, status, is_renewal, number,
        subtotal, total, issued_at, period_start, period_end)
     VALUES ($1, $2, 'INR', $3, true, $4, $5, $5, now(), CURRENT_DATE, CURRENT_DATE + 365)
     RETURNING id, number, total::text AS total`,
    [institutionId, packageId, opts.status ?? "issued", opts.number, total]
  );
  return rows[0];
}

async function configureGateway(over: Record<string, unknown> = {}, superToken?: string) {
  const token = superToken!;
  return request(app)
    .patch("/api/v1/platform/payment-gateway")
    .set(auth(token))
    .send({
      enabled: true,
      keyId: "rzp_test_recurring",
      keySecret: "secret_recurring_9876",
      webhookSecret: WH_SECRET,
      defaultCurrency: "INR",
      autoChargeEnabled: true,
      dunningMaxAttempts: 3,
      dunningRetryIntervalDays: 3,
      suspendOnDunningExhausted: true,
      renewalLeadDays: 0,
      ...over,
    });
}

function sendRenewalWebhook(
  invoice: { id: string; number: string; total: string },
  eventId: string,
  over: { secret?: string; signature?: string } = {}
) {
  const amountPaise = Math.round(Number(invoice.total) * 100);
  const body = {
    event: "payment_link.paid",
    payload: {
      payment_link: {
        entity: {
          id: `plink_${eventId}`,
          reference_id: invoice.number,
          notes: { invoice_id: invoice.id },
          amount: amountPaise,
        },
      },
      payment: { entity: { id: `pay_${eventId}`, amount: amountPaise } },
    },
  };
  const raw = JSON.stringify(body);
  const signature = over.signature ?? signPayload(raw, over.secret ?? WH_SECRET);
  return request(app)
    .post("/api/v1/platform/payments/webhook")
    .set("Content-Type", "application/json")
    .set("x-razorpay-signature", signature)
    .set("x-razorpay-event-id", eventId)
    .send(raw);
}

describe("billing B4: recurring billing + dunning", () => {
  let superToken: string;
  let adminToken: string;
  let pkgId: string;

  beforeEach(async () => {
    await resetDb();
    await createUser({ ...SUPER, role: "super_admin" });
    await createUser({ ...ADMIN, role: "admin" });
    superToken = await tokenFor(SUPER.email, SUPER.password);
    adminToken = await tokenFor(ADMIN.email, ADMIN.password);
    pkgId = await makePackage();
  });

  it("blocks non-super-admins from run-recurring and the auto-charge toggle", async () => {
    const inst = await createInstitution("GRD");
    await makeSub(inst, pkgId, {});
    expect(
      (await request(app).post("/api/v1/platform/subscriptions/run-recurring").set(auth(adminToken))).status
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/v1/platform/institutions/${inst}/subscription/auto-charge`)
          .set(auth(adminToken))
          .send({ autoCharge: true })
      ).status
    ).toBe(403);
  });

  it("is a clean no-op when auto-charge is disabled (default) — no invoices, no state change", async () => {
    const inst = await createInstitution("NOP");
    // Due to renew today, opted in per-subscription, BUT the gateway master switch off.
    const subId = await makeSub(inst, pkgId, { renewsExpr: "CURRENT_DATE", autoCharge: true });
    // Gateway present but auto-charge master switch OFF.
    await configureGateway({ autoChargeEnabled: false }, superToken);

    const run = await request(app)
      .post("/api/v1/platform/subscriptions/run-recurring")
      .set(auth(superToken));
    expect(run.status).toBe(200);
    expect(run.body.enabled).toBe(false);
    expect(run.body.renewalsGenerated).toBe(0);
    expect(run.body.dunningRetried).toBe(0);

    // No invoice created, subscription untouched.
    const invs = await query("SELECT count(*)::int AS c FROM saas_invoices WHERE institution_id = $1", [inst]);
    expect(invs.rows[0].c).toBe(0);
    const sub = await query<{ dunning_state: string; next_retry_at: string | null }>(
      "SELECT dunning_state, next_retry_at FROM institution_subscriptions WHERE id = $1",
      [subId]
    );
    expect(sub.rows[0].dunning_state).toBe("none");
    expect(sub.rows[0].next_retry_at).toBeNull();
  });

  it("dunning: unpaid renewal advances retrying → exhausted + institution suspended after N", async () => {
    const inst = await createInstitution("DUN");
    // A subscription already in dunning with an open renewal invoice, next retry due now.
    const subId = await makeSub(inst, pkgId, {
      autoCharge: true,
      dunningState: "none",
      dunningAttempts: 0,
      nextRetryExpr: "now() - interval '1 hour'",
    });
    await makeRenewalInvoice(inst, pkgId, { number: "RENEW-DUN", status: "issued" });
    await configureGateway({ dunningMaxAttempts: 3, dunningRetryIntervalDays: 3 }, superToken);

    // Tick 1: attempt 1 → retrying.
    const r1 = await request(app).post("/api/v1/platform/subscriptions/run-recurring").set(auth(superToken));
    expect(r1.body.enabled).toBe(true);
    expect(r1.body.dunningRetried).toBe(1);
    let sub = await query<{ dunning_state: string; dunning_attempts: number; next_retry_at: string | null }>(
      "SELECT dunning_state, dunning_attempts, next_retry_at FROM institution_subscriptions WHERE id = $1",
      [subId]
    );
    expect(sub.rows[0].dunning_state).toBe("retrying");
    expect(sub.rows[0].dunning_attempts).toBe(1);
    expect(sub.rows[0].next_retry_at).not.toBeNull();

    // Tick again immediately → no-op (next_retry_at is in the future now).
    const rNoop = await request(app).post("/api/v1/platform/subscriptions/run-recurring").set(auth(superToken));
    expect(rNoop.body.dunningRetried).toBe(0);

    // Force the clock back and tick: attempt 2 → still retrying.
    await query("UPDATE institution_subscriptions SET next_retry_at = now() - interval '1 hour' WHERE id = $1", [subId]);
    const r2 = await request(app).post("/api/v1/platform/subscriptions/run-recurring").set(auth(superToken));
    expect(r2.body.dunningRetried).toBe(1);
    sub = await query("SELECT dunning_state, dunning_attempts, next_retry_at FROM institution_subscriptions WHERE id = $1", [subId]);
    expect(sub.rows[0].dunning_attempts).toBe(2);
    expect(sub.rows[0].dunning_state).toBe("retrying");

    // Force back again and tick: attempt 3 hits the cap → exhausted + suspended.
    await query("UPDATE institution_subscriptions SET next_retry_at = now() - interval '1 hour' WHERE id = $1", [subId]);
    const r3 = await request(app).post("/api/v1/platform/subscriptions/run-recurring").set(auth(superToken));
    expect(r3.body.dunningExhausted).toBe(1);
    expect(r3.body.suspended).toBe(1);
    sub = await query("SELECT dunning_state, dunning_attempts, next_retry_at FROM institution_subscriptions WHERE id = $1", [subId]);
    expect(sub.rows[0].dunning_state).toBe("exhausted");
    expect(sub.rows[0].dunning_attempts).toBe(3);
    expect(sub.rows[0].next_retry_at).toBeNull();

    const instRow = await query<{ is_active: boolean }>("SELECT is_active FROM institutions WHERE id = $1", [inst]);
    expect(instRow.rows[0].is_active).toBe(false);

    // Exhausted subscription is a no-op on further ticks (never re-suspends / re-tries).
    const r4 = await request(app).post("/api/v1/platform/subscriptions/run-recurring").set(auth(superToken));
    expect(r4.body.dunningRetried).toBe(0);
    expect(r4.body.dunningExhausted).toBe(0);
    expect(r4.body.suspended).toBe(0);

    // Invoice is never deleted.
    const invRow = await query<{ status: string }>("SELECT status FROM saas_invoices WHERE institution_id = $1", [inst]);
    expect(invRow.rows[0].status).toBe("issued");

    // The state changes are audited.
    const events = await request(app)
      .get(`/api/v1/platform/institutions/${inst}/subscription/events`)
      .set(auth(superToken));
    const kinds = (events.body as { event: string }[]).map((e) => e.event);
    expect(kinds).toContain("dunning_retry");
    expect(kinds).toContain("dunning_exhausted");
  });

  it("webhook settles a renewal → paid + renews_at extended + dunning cleared + tenant reactivated", async () => {
    const inst = await createInstitution("WHK");
    // A dunning-exhausted, suspended subscription with an open renewal invoice.
    const subId = await makeSub(inst, pkgId, {
      renewsExpr: "CURRENT_DATE + 5",
      autoCharge: true,
      dunningState: "exhausted",
      dunningAttempts: 3,
      nextRetryExpr: null,
    });
    await query("UPDATE institutions SET is_active = false WHERE id = $1", [inst]);
    const inv = await makeRenewalInvoice(inst, pkgId, { number: "RENEW-WHK", status: "issued", total: 12000 });
    await configureGateway({}, superToken);

    // Capture the pre-settlement renews_at.
    const before = await query<{ renews_at: string }>(
      "SELECT to_char(renews_at, 'YYYY-MM-DD') AS renews_at FROM institution_subscriptions WHERE id = $1",
      [subId]
    );

    const res = await sendRenewalWebhook(inv, "evt_renew_1");
    expect(res.status).toBe(200);
    expect(res.body.marked).toBe(true);
    expect(res.body.renewed).toBe(true);

    // Invoice is paid.
    const invAfter = await request(app).get(`/api/v1/platform/invoices/${inv.id}`).set(auth(superToken));
    expect(invAfter.body.status).toBe("paid");

    // Subscription: active, dunning cleared, renews_at moved forward one year (annual).
    const sub = await query<{
      status: string;
      dunning_state: string;
      dunning_attempts: number;
      next_retry_at: string | null;
      last_payment_error: string | null;
      renews_at: string;
    }>(
      `SELECT status, dunning_state, dunning_attempts, next_retry_at, last_payment_error,
              to_char(renews_at, 'YYYY-MM-DD') AS renews_at
       FROM institution_subscriptions WHERE id = $1`,
      [subId]
    );
    expect(sub.rows[0].status).toBe("active");
    expect(sub.rows[0].dunning_state).toBe("none");
    expect(sub.rows[0].dunning_attempts).toBe(0);
    expect(sub.rows[0].next_retry_at).toBeNull();
    expect(sub.rows[0].last_payment_error).toBeNull();
    expect(new Date(sub.rows[0].renews_at).getTime()).toBeGreaterThan(
      new Date(before.rows[0].renews_at).getTime()
    );

    // Tenant reactivated (was suspended by dunning).
    const instRow = await query<{ is_active: boolean }>("SELECT is_active FROM institutions WHERE id = $1", [inst]);
    expect(instRow.rows[0].is_active).toBe(true);

    // Renewal recorded.
    const events = await request(app)
      .get(`/api/v1/platform/institutions/${inst}/subscription/events`)
      .set(auth(superToken));
    expect((events.body as { event: string }[]).some((e) => e.event === "renewed")).toBe(true);
  });

  it("webhook is idempotent — a duplicate renewal event does not double-extend", async () => {
    const inst = await createInstitution("IDP");
    const subId = await makeSub(inst, pkgId, { renewsExpr: "CURRENT_DATE + 5", autoCharge: true });
    const inv = await makeRenewalInvoice(inst, pkgId, { number: "RENEW-IDP", status: "issued" });
    await configureGateway({}, superToken);

    const first = await sendRenewalWebhook(inv, "evt_dup_renew");
    expect(first.body.renewed).toBe(true);
    const after1 = await query<{ renews_at: string }>(
      "SELECT to_char(renews_at, 'YYYY-MM-DD') AS renews_at FROM institution_subscriptions WHERE id = $1",
      [subId]
    );

    const second = await sendRenewalWebhook(inv, "evt_dup_renew");
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    const after2 = await query<{ renews_at: string }>(
      "SELECT to_char(renews_at, 'YYYY-MM-DD') AS renews_at FROM institution_subscriptions WHERE id = $1",
      [subId]
    );
    // renews_at unchanged by the duplicate (extended exactly once).
    expect(after2.rows[0].renews_at).toBe(after1.rows[0].renews_at);
  });

  it("rejects a renewal webhook with a bad signature (401) and does not change state", async () => {
    const inst = await createInstitution("BAD");
    const subId = await makeSub(inst, pkgId, { renewsExpr: "CURRENT_DATE + 5", autoCharge: true });
    const inv = await makeRenewalInvoice(inst, pkgId, { number: "RENEW-BAD", status: "issued" });
    await configureGateway({}, superToken);

    const res = await sendRenewalWebhook(inv, "evt_bad_sig", { signature: "deadbeef" });
    expect(res.status).toBe(401);

    const invAfter = await request(app).get(`/api/v1/platform/invoices/${inv.id}`).set(auth(superToken));
    expect(invAfter.body.status).toBe("issued"); // unchanged
    const sub = await query<{ status: string }>("SELECT status FROM institution_subscriptions WHERE id = $1", [subId]);
    expect(sub.rows[0].status).toBe("active"); // unchanged
  });

  it("per-subscription auto-charge toggle enrols the latest subscription (audited)", async () => {
    const inst = await createInstitution("TGL");
    const subId = await makeSub(inst, pkgId, { autoCharge: false });

    const on = await request(app)
      .post(`/api/v1/platform/institutions/${inst}/subscription/auto-charge`)
      .set(auth(superToken))
      .send({ autoCharge: true });
    expect(on.status).toBe(200);
    expect(on.body.autoCharge).toBe(true);
    expect(on.body.subscriptionId).toBe(subId);

    const sub = await query<{ auto_charge: boolean }>(
      "SELECT auto_charge FROM institution_subscriptions WHERE id = $1",
      [subId]
    );
    expect(sub.rows[0].auto_charge).toBe(true);

    // Surfaced on the status read (dunning fields exposed).
    const status = await request(app)
      .get(`/api/v1/platform/institutions/${inst}/subscription/status`)
      .set(auth(superToken));
    expect(status.body.autoCharge).toBe(true);
    expect(status.body.dunningState).toBe("none");
  });

  it("gateway settings expose + validate the recurring/dunning policy bounds", async () => {
    // Out-of-range dunning attempts rejected by zod (1..10).
    const bad = await request(app)
      .patch("/api/v1/platform/payment-gateway")
      .set(auth(superToken))
      .send({ dunningMaxAttempts: 99 });
    expect(bad.status).toBe(400);

    await configureGateway({}, superToken);
    const view = await request(app).get("/api/v1/platform/payment-gateway").set(auth(superToken));
    expect(view.body.autoChargeEnabled).toBe(true);
    expect(view.body.dunningMaxAttempts).toBe(3);
    expect(view.body.dunningRetryIntervalDays).toBe(3);
    expect(view.body.suspendOnDunningExhausted).toBe(true);
    expect(view.body.renewalLeadDays).toBe(0);
    expect(view.body.recurringActive).toBe(true); // enabled + configured + master on
  });
});
