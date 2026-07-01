"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorNote, PageHeader, Select, Spinner } from "@/components/ui";
import { BarChart, DonutChart } from "@/components/charts";
import { formatMoney } from "@/lib/format";
import type { PlatformRevenue } from "@/types";
import { usePlatformGuard } from "../platform/_guard";
import { formatNumber } from "../platform/_utils";

const MONTH_OPTIONS = [6, 12, 18, 24];

/** "2026-07" → "Jul 26" for compact trend axis labels. */
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  const idx = Number(m) - 1;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (idx < 0 || idx > 11) return ym;
  return `${names[idx]} ${y.slice(2)}`;
}

function KpiCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </Card>
  );
}

export default function PlatformRevenuePage() {
  const { ready, gate } = usePlatformGuard(
    "Revenue",
    "SaaS MRR/ARR, subscription mix & deferred revenue"
  );

  const [data, setData] = useState<PlatformRevenue | null>(null);
  const [months, setMonths] = useState(12);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<PlatformRevenue>(`/platform/revenue?months=${months}`);
      setData(r);
      setRefreshedAt(new Date());
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load revenue report");
    } finally {
      setLoading(false);
    }
  }, [months]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  if (!ready) return gate;

  const statusMix = data
    ? [
        { label: "active", value: data.byStatus.active },
        { label: "trialing", value: data.byStatus.trialing },
        { label: "suspended", value: data.byStatus.suspended },
        { label: "cancelled", value: data.byStatus.cancelled },
        { label: "expired", value: data.byStatus.expired },
      ].filter((s) => s.value > 0)
    : [];

  const trend = data ? data.trend.map((t) => ({ label: monthLabel(t.month), value: t.total })) : [];

  return (
    <>
      <PageHeader
        title="Revenue"
        subtitle="SaaS MRR/ARR, subscription mix & deferred revenue"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {refreshedAt && (
              <span className="text-xs text-slate-400">Updated {refreshedAt.toLocaleTimeString()}</span>
            )}
            <Select
              value={String(months)}
              onChange={(e) => setMonths(Number(e.target.value))}
              className="w-36"
              aria-label="Trend window"
            >
              {MONTH_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  Last {m} months
                </option>
              ))}
            </Select>
            <Button variant="secondary" onClick={load} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
        }
      />

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : data ? (
        <div className="space-y-8">
          {data.mixedCurrency && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              <Badge tone="amber">warning</Badge>
              <span>
                Multiple currencies in use — headline figures are shown in{" "}
                <strong>{data.currency}</strong>. See the per-currency breakdown below.
              </span>
            </div>
          )}

          {/* Headline KPIs (dominant currency) */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="MRR" value={formatMoney(data.mrr, data.currency)} hint="Monthly recurring revenue" />
            <KpiCard label="ARR" value={formatMoney(data.arr, data.currency)} hint="Annual recurring revenue" />
            <KpiCard
              label="Deferred revenue"
              value={formatMoney(data.deferredRevenue, data.currency)}
              hint="Unrecognized (future-period invoices)"
            />
            <KpiCard
              label="Active subscriptions"
              value={formatNumber(data.byStatus.active)}
              hint={`${formatNumber(data.trialingCount)} trialing`}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Trend */}
            <Card>
              <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Invoice revenue trend
              </h2>
              <p className="mb-3 text-xs text-slate-400">
                Issued + paid invoice totals per month ({data.currency}).
              </p>
              <BarChart data={trend} format={(v) => formatMoney(v, data.currency)} />
            </Card>

            {/* Status mix */}
            <Card>
              <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Subscription status mix
              </h2>
              <p className="mb-3 text-xs text-slate-400">All institution subscriptions by status.</p>
              {statusMix.length ? (
                <DonutChart data={statusMix} />
              ) : (
                <EmptyState message="No subscriptions yet." />
              )}
            </Card>
          </div>

          {/* Per-currency breakdown */}
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              By currency
            </h2>
            {data.byCurrency.length ? (
              <Card className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-3 font-medium">Currency</th>
                      <th className="px-4 py-3 font-medium">MRR</th>
                      <th className="px-4 py-3 font-medium">ARR</th>
                      <th className="px-4 py-3 font-medium">Active subs</th>
                      <th className="px-4 py-3 font-medium">Deferred</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byCurrency.map((c) => (
                      <tr key={c.currency} className="border-b border-line last:border-0">
                        <td className="px-4 py-3 font-medium text-ink">
                          <span className="inline-flex items-center gap-2">
                            {c.currency}
                            {c.currency === data.currency && <Badge tone="blue">headline</Badge>}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-ink">{formatMoney(c.mrr, c.currency)}</td>
                        <td className="px-4 py-3 text-ink">{formatMoney(c.arr, c.currency)}</td>
                        <td className="px-4 py-3 text-muted">{formatNumber(c.activeSubscriptions)}</td>
                        <td className="px-4 py-3 text-muted">{formatMoney(c.deferredRevenue, c.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ) : (
              <EmptyState message="No revenue yet." />
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
