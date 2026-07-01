// SaaS-operator revenue reporting (Billing Phase B5).
//
// Read-only aggregation for the platform super-admin: MRR/ARR, subscription
// status mix, and deferred (unrecognized) revenue — computed entirely from the
// EXISTING billing tables (subscription_packages, institution_subscriptions,
// saas_invoices). No new migration; nothing here writes.
//
// Money is NEVER summed across currencies. The headline (mrr/arr/deferred) is
// reported in the *dominant* currency (the one with the most active subs), a
// `mixedCurrency` flag warns when more than one currency is in play, and a full
// `byCurrency` breakdown is always returned so nothing is hidden.

import { query } from "../../db/postgres";

// Monthly-normalization divisors (monthly÷1, quarterly÷3, half_yearly÷6,
// annual÷12) are applied in SQL inside mrrByCurrency() so the sum stays a single
// set-based aggregation.

export interface RevenueByCurrency {
  currency: string;
  mrr: number;
  arr: number;
  activeSubscriptions: number;
  deferredRevenue: number;
}

export interface RevenueByStatus {
  active: number;
  trialing: number;
  suspended: number;
  cancelled: number;
  expired: number;
}

export interface RevenueTrendPoint {
  month: string; // YYYY-MM
  total: number;
}

export interface PlatformRevenue {
  currency: string; // dominant currency for the headline figures
  mixedCurrency: boolean;
  mrr: number;
  arr: number;
  byStatus: RevenueByStatus;
  trialingCount: number;
  deferredRevenue: number;
  byCurrency: RevenueByCurrency[];
  trend: RevenueTrendPoint[];
}

/**
 * MRR per currency = Σ over active subscriptions of the package price normalized
 * to a monthly amount (monthly÷1, quarterly÷3, half_yearly÷6, annual÷12). Only
 * `status = 'active'` subscriptions contribute recurring revenue; ARR = MRR×12.
 * The currency is the package's currency (subscriptions have no own currency).
 */
async function mrrByCurrency(): Promise<Map<string, { mrr: number; activeSubscriptions: number }>> {
  const { rows } = await query<{ currency: string; mrr: number; activeSubscriptions: number }>(
    `SELECT
       COALESCE(p.currency, 'INR') AS currency,
       COALESCE(SUM(
         p.price / CASE p.billing_cycle
           WHEN 'monthly'     THEN 1
           WHEN 'quarterly'   THEN 3
           WHEN 'half_yearly' THEN 6
           WHEN 'annual'      THEN 12
           ELSE 12
         END
       ), 0)::float AS mrr,
       COUNT(*)::int AS "activeSubscriptions"
     FROM institution_subscriptions s
     JOIN subscription_packages p ON p.id = s.package_id
     WHERE s.status = 'active'
     GROUP BY COALESCE(p.currency, 'INR')`
  );
  const map = new Map<string, { mrr: number; activeSubscriptions: number }>();
  for (const r of rows) {
    map.set(r.currency, { mrr: Number(r.mrr), activeSubscriptions: Number(r.activeSubscriptions) });
  }
  return map;
}

/** Subscription counts by status across all institutions. */
async function statusMix(): Promise<RevenueByStatus> {
  const { rows } = await query<{ status: string; n: number }>(
    `SELECT status, COUNT(*)::int AS n FROM institution_subscriptions GROUP BY status`
  );
  const mix: RevenueByStatus = {
    active: 0,
    trialing: 0,
    suspended: 0,
    cancelled: 0,
    expired: 0,
  };
  for (const r of rows) {
    if (r.status in mix) mix[r.status as keyof RevenueByStatus] = Number(r.n);
  }
  return mix;
}

/**
 * Deferred (unrecognized) revenue per currency.
 *
 * For every issued/paid invoice whose billing period extends into the future,
 * the slice that has NOT yet been earned is `total × (days remaining ÷ total
 * period days)`, where "days remaining" is measured from today to period_end
 * (clamped to the period length, and to ≥0). Invoices already fully in the past
 * contribute nothing; void/draft invoices are excluded. Summed in SQL per
 * currency so figures are never mixed across currencies.
 */
async function deferredByCurrency(): Promise<Map<string, number>> {
  const { rows } = await query<{ currency: string; deferred: number }>(
    `SELECT
       COALESCE(currency, 'INR') AS currency,
       COALESCE(SUM(
         total * (
           LEAST(
             GREATEST((period_end - CURRENT_DATE)::numeric, 0),
             (period_end - period_start + 1)::numeric
           )
           / NULLIF((period_end - period_start + 1)::numeric, 0)
         )
       ), 0)::float AS deferred
     FROM saas_invoices
     WHERE status IN ('issued', 'paid')
       AND period_start IS NOT NULL
       AND period_end IS NOT NULL
       AND period_end >= CURRENT_DATE
     GROUP BY COALESCE(currency, 'INR')`
  );
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.currency, Number(r.deferred));
  return map;
}

/**
 * Monthly issued+paid invoice totals for the last `months` months, in the
 * dominant currency only (a trend line mixing currencies would be meaningless).
 * Returns a dense series (zero-filled) oldest → newest.
 */
async function invoiceTrend(months: number, currency: string): Promise<RevenueTrendPoint[]> {
  const { rows } = await query<{ month: string; total: number }>(
    `WITH series AS (
       SELECT to_char(gs, 'YYYY-MM') AS month
       FROM generate_series(
         date_trunc('month', CURRENT_DATE) - make_interval(months => $1::int - 1),
         date_trunc('month', CURRENT_DATE),
         interval '1 month'
       ) AS gs
     )
     SELECT s.month,
            COALESCE(SUM(i.total), 0)::float AS total
     FROM series s
     LEFT JOIN saas_invoices i
       ON to_char(COALESCE(i.issued_at, i.created_at), 'YYYY-MM') = s.month
      AND i.status IN ('issued', 'paid')
      AND COALESCE(i.currency, 'INR') = $2
     GROUP BY s.month
     ORDER BY s.month ASC`,
    [months, currency]
  );
  return rows.map((r) => ({ month: r.month, total: Number(r.total) }));
}

/**
 * Assemble the platform revenue report. `months` bounds the trend window
 * (already validated 1–24 by the route schema; defaulted to 12).
 */
export async function platformRevenue(months = 12): Promise<PlatformRevenue> {
  const [mrrMap, byStatus, deferredMap] = await Promise.all([
    mrrByCurrency(),
    statusMix(),
    deferredByCurrency(),
  ]);

  // Union of every currency seen on either the recurring or the deferred side.
  const currencies = new Set<string>([...mrrMap.keys(), ...deferredMap.keys()]);

  const byCurrency: RevenueByCurrency[] = Array.from(currencies)
    .map((currency) => {
      const m = mrrMap.get(currency);
      const mrr = round2(m?.mrr ?? 0);
      return {
        currency,
        mrr,
        arr: round2(mrr * 12),
        activeSubscriptions: m?.activeSubscriptions ?? 0,
        deferredRevenue: round2(deferredMap.get(currency) ?? 0),
      };
    })
    // Dominant first: highest MRR, then most active subs, then currency code.
    .sort(
      (a, b) =>
        b.mrr - a.mrr ||
        b.activeSubscriptions - a.activeSubscriptions ||
        a.currency.localeCompare(b.currency)
    );

  const dominant = byCurrency[0];
  const currency = dominant?.currency ?? "INR";
  const trend = await invoiceTrend(months, currency);

  return {
    currency,
    mixedCurrency: byCurrency.length > 1,
    mrr: dominant?.mrr ?? 0,
    arr: dominant?.arr ?? 0,
    byStatus,
    trialingCount: byStatus.trialing,
    deferredRevenue: dominant?.deferredRevenue ?? 0,
    byCurrency,
    trend,
  };
}

/** Round to 2 dp (money) without floating-point drift in the response. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
