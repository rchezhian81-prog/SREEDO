"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import { toast } from "@/components/toast";
import { usePlatformGuard } from "../../platform/_guard";
import {
  cellText,
  downloadExport,
  REPORT_KEYS,
  type ReportResult,
} from "../_subs";

// Reports whose result depends on a trailing-month window vs a "soon" horizon.
const MONTH_KEYS = ["mrr", "arr", "churn", "trial_conversion"];
const SOON_KEYS = ["expiring", "renewal_due"];

export default function SubscriptionReportsPage() {
  const { ready, gate } = usePlatformGuard(
    "Subscription reports",
    "Ready-made subscription & revenue reports"
  );

  const [key, setKey] = useState<string>("active");
  const [months, setMonths] = useState(12);
  const [soonDays, setSoonDays] = useState(30);
  const [data, setData] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    p.set("key", key);
    if (MONTH_KEYS.includes(key)) p.set("months", String(months));
    if (SOON_KEYS.includes(key)) p.set("soonDays", String(soonDays));
    return p;
  }, [key, months, soonDays]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = buildParams();
      p.set("format", "json");
      setData(
        await api.get<ReportResult>(
          `/platform/subscriptions/reports?${p.toString()}`
        )
      );
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const doExport = async (format: "csv" | "xlsx") => {
    const p = buildParams();
    p.set("format", format);
    try {
      await downloadExport(
        `/platform/subscriptions/reports?${p.toString()}`,
        `subscription-report-${key}.${format}`
      );
    } catch {
      toast.error("Export failed");
    }
  };

  if (!ready) return gate;

  const totals = data?.totals ?? null;

  return (
    <>
      <nav className="mb-2 text-xs text-faint">
        <Link href="/super-admin/subscriptions" className="hover:text-muted">
          Subscriptions
        </Link>{" "}
        / <span className="text-muted">Reports</span>
      </nav>
      <PageHeader
        title="Subscription reports"
        subtitle="Ready-made subscription & revenue reports (super-admin)"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => doExport("csv")}>
              Export CSV
            </Button>
            <Button variant="secondary" onClick={() => doExport("xlsx")}>
              Export Excel
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-64">
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Report
          </label>
          <Select value={key} onChange={(e) => setKey(e.target.value)}>
            {REPORT_KEYS.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </Select>
        </div>
        {MONTH_KEYS.includes(key) && (
          <div className="w-40">
            <label className="mb-1.5 block text-sm font-medium text-ink">
              Window
            </label>
            <Select
              value={String(months)}
              onChange={(e) => setMonths(Number(e.target.value))}
            >
              {[6, 12, 18, 24].map((m) => (
                <option key={m} value={m}>
                  Last {m} months
                </option>
              ))}
            </Select>
          </div>
        )}
        {SOON_KEYS.includes(key) && (
          <div className="w-40">
            <label className="mb-1.5 block text-sm font-medium text-ink">
              Horizon (days)
            </label>
            <Select
              value={String(soonDays)}
              onChange={(e) => setSoonDays(Number(e.target.value))}
            >
              {[7, 15, 30, 60, 90].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : !data ? null : data.rows.length === 0 ? (
        <EmptyState message="No rows for this report" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  {data.columns.map((c) => (
                    <th key={c.key} className="px-4 py-3">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((row, i) => (
                  <tr key={i} className="hover:bg-surface-2">
                    {data.columns.map((c) => (
                      <td key={c.key} className="px-4 py-3 text-ink">
                        {cellText(row[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totals && Object.keys(totals).length > 0 && (
            <div className="mt-3 flex flex-wrap gap-4 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
              <span className="font-semibold text-ink">Totals</span>
              {Object.entries(totals).map(([k, v]) => (
                <span key={k} className="text-muted">
                  {k}: <span className="font-medium text-ink">{cellText(v)}</span>
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
