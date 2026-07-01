import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";

const SUPER = { email: "super@test.dev", password: "Passw0rd!" };
const ADMIN = { email: "admin@test.dev", password: "Passw0rd!" };
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Insert a subscription_packages row directly; returns its id. */
async function seedPackage(opts: {
  name: string;
  price: number;
  billingCycle: "monthly" | "quarterly" | "half_yearly" | "annual";
  currency?: string;
}): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO subscription_packages (name, price, billing_cycle, currency)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [opts.name, opts.price, opts.billingCycle, opts.currency ?? "INR"]
  );
  return rows[0].id;
}

/** Insert an institution_subscriptions row directly. */
async function seedSubscription(
  institutionId: string,
  packageId: string,
  status: "active" | "trialing" | "suspended" | "cancelled" | "expired"
): Promise<void> {
  await query(
    `INSERT INTO institution_subscriptions (institution_id, package_id, status)
     VALUES ($1, $2, $3)`,
    [institutionId, packageId, status]
  );
}

describe("super admin B5: revenue reporting", () => {
  let superToken: string;

  beforeEach(async () => {
    await resetDb();
    await createUser({ ...SUPER, role: "super_admin" });
    await createUser({ ...ADMIN, role: "admin" });
    superToken = await tokenFor(SUPER.email, SUPER.password);
  });

  const getRevenue = (qs = "") =>
    request(app).get(`/api/v1/platform/revenue${qs}`).set(auth(superToken));

  it("blocks non-super-admins with 403", async () => {
    const adminToken = await tokenFor(ADMIN.email, ADMIN.password);
    const res = await request(app).get("/api/v1/platform/revenue").set(auth(adminToken));
    expect(res.status).toBe(403);
  });

  it("returns a zeroed report when there is no billing data", async () => {
    const res = await getRevenue();
    expect(res.status).toBe(200);
    expect(res.body.mrr).toBe(0);
    expect(res.body.arr).toBe(0);
    expect(res.body.deferredRevenue).toBe(0);
    expect(res.body.mixedCurrency).toBe(false);
    expect(res.body.byStatus).toEqual({
      active: 0,
      trialing: 0,
      suspended: 0,
      cancelled: 0,
      expired: 0,
    });
    expect(res.body.byCurrency).toEqual([]);
    // Trend is a dense, zero-filled series (default 12 months).
    expect(res.body.trend).toHaveLength(12);
    expect(res.body.trend.every((t: { total: number }) => t.total === 0)).toBe(true);
  });

  it("computes MRR/ARR (cycle-normalized), status counts and honours the months bound", async () => {
    const inst = await createInstitution("REV", "school");

    // Varied billing cycles → each normalizes to 100/month.
    const monthly = await seedPackage({ name: "Monthly", price: 100, billingCycle: "monthly" });
    const quarterly = await seedPackage({ name: "Quarterly", price: 300, billingCycle: "quarterly" });
    const half = await seedPackage({ name: "Half", price: 600, billingCycle: "half_yearly" });
    const annual = await seedPackage({ name: "Annual", price: 1200, billingCycle: "annual" });
    // A trialing sub must NOT contribute to MRR.
    const trialPkg = await seedPackage({ name: "Trial", price: 9999, billingCycle: "monthly" });

    await seedSubscription(inst, monthly, "active");
    await seedSubscription(inst, quarterly, "active");
    await seedSubscription(inst, half, "active");
    await seedSubscription(inst, annual, "active");
    await seedSubscription(inst, trialPkg, "trialing");
    await seedSubscription(inst, monthly, "suspended");
    await seedSubscription(inst, annual, "cancelled");
    await seedSubscription(inst, annual, "expired");

    const res = await getRevenue("?months=6");
    expect(res.status).toBe(200);

    // 4 active subs each = 100/month → MRR 400, ARR 4800. Trialing excluded.
    expect(res.body.mrr).toBe(400);
    expect(res.body.arr).toBe(4800);
    expect(res.body.currency).toBe("INR");
    expect(res.body.mixedCurrency).toBe(false);

    expect(res.body.byStatus).toEqual({
      active: 4,
      trialing: 1,
      suspended: 1,
      cancelled: 1,
      expired: 1,
    });
    expect(res.body.trialingCount).toBe(1);

    // months=6 → 6-point trend.
    expect(res.body.trend).toHaveLength(6);

    // Single currency → one byCurrency row matching the headline.
    expect(res.body.byCurrency).toHaveLength(1);
    expect(res.body.byCurrency[0]).toMatchObject({ currency: "INR", mrr: 400, arr: 4800 });
  });

  it("recognizes deferred revenue for a future-period paid invoice (>0 and <= total)", async () => {
    const inst = await createInstitution("DEF", "school");
    const pkg = await seedPackage({ name: "Plan", price: 1200, billingCycle: "annual" });
    await seedSubscription(inst, pkg, "active");

    // A 12-month PAID invoice starting today: almost the whole period is in the
    // future, so most of the total should be deferred (but never exceed it).
    const total = 1200;
    await query(
      `INSERT INTO saas_invoices
         (institution_id, status, currency, period_start, period_end,
          subtotal, total, issued_at, paid_at)
       VALUES ($1, 'paid', 'INR', CURRENT_DATE, CURRENT_DATE + INTERVAL '1 year',
               $2, $2, now(), now())`,
      [inst, total]
    );

    const res = await getRevenue();
    expect(res.status).toBe(200);
    expect(res.body.deferredRevenue).toBeGreaterThan(0);
    expect(res.body.deferredRevenue).toBeLessThanOrEqual(total);
    // Nearly the full amount is unrecognized at the start of the period.
    expect(res.body.deferredRevenue).toBeGreaterThan(total * 0.9);

    // A fully-past invoice contributes nothing to deferred revenue.
    await query(
      `INSERT INTO saas_invoices
         (institution_id, status, currency, period_start, period_end,
          subtotal, total, issued_at, paid_at)
       VALUES ($1, 'paid', 'INR', CURRENT_DATE - INTERVAL '2 years',
               CURRENT_DATE - INTERVAL '1 year', 500, 500, now(), now())`,
      [inst]
    );
    const res2 = await getRevenue();
    // Deferred is unchanged (past invoice ignored; small float tolerance).
    expect(Math.abs(res2.body.deferredRevenue - res.body.deferredRevenue)).toBeLessThan(0.01);
  });

  it("never sums across currencies: flags mixedCurrency and lists each in byCurrency", async () => {
    const inst = await createInstitution("MIX", "college");
    const inr = await seedPackage({ name: "INR Plan", price: 500, billingCycle: "monthly", currency: "INR" });
    const usd = await seedPackage({ name: "USD Plan", price: 100, billingCycle: "monthly", currency: "USD" });
    // INR has the larger MRR → it becomes the dominant/headline currency.
    await seedSubscription(inst, inr, "active");
    await seedSubscription(inst, usd, "active");

    const res = await getRevenue();
    expect(res.status).toBe(200);
    expect(res.body.mixedCurrency).toBe(true);
    expect(res.body.currency).toBe("INR");
    expect(res.body.mrr).toBe(500); // NOT 600 — currencies are not summed.

    const codes = res.body.byCurrency.map((c: { currency: string }) => c.currency).sort();
    expect(codes).toEqual(["INR", "USD"]);
    const usdRow = res.body.byCurrency.find((c: { currency: string }) => c.currency === "USD");
    expect(usdRow.mrr).toBe(100);
    expect(usdRow.arr).toBe(1200);
  });

  it("validates the months bound (rejects out-of-range)", async () => {
    expect((await getRevenue("?months=0")).status).toBe(400);
    expect((await getRevenue("?months=25")).status).toBe(400);
    expect((await getRevenue("?months=24")).status).toBe(200);
  });
});
