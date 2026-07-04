"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Card, EmptyState, ErrorNote, Input, Spinner } from "@/components/ui";
import type { AuditSummary } from "@/types";
import { formatNumber } from "../../_utils";
import {
  formatDateTime,
  severityLabel,
  severityTone,
  type AuditFilterState,
} from "./taxonomy";

type Win = AuditSummary["window"];
const WINDOWS: { value: Win; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "custom", label: "Custom" },
];

const BUCKETS: { key: keyof AuditSummary["buckets"]; label: string }[] = [
  { key: "authSecurity", label: "Auth & Security" },
  { key: "rbacSecurity", label: "RBAC & Admins" },
  { key: "tenant", label: "Tenant Mgmt" },
  { key: "billingInvoice", label: "Billing & Invoice" },
  { key: "support", label: "Support Access" },
  { key: "export", label: "Data Export" },
];

export function SummaryCards({
  window,
  from,
  to,
  onWindowChange,
  onCustomChange,
  onActorClick,
  onOpenEvent,
}: {
  window: Win;
  from: string;
  to: string;
  onWindowChange: (w: Win) => void;
  onCustomChange: (from: string, to: string) => void;
  onActorClick: (field: keyof AuditFilterState, value: string) => void;
  onOpenEvent: (id: string) => void;
}) {
  const [data, setData] = useState<AuditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ window });
      if (window === "custom") {
        if (from) p.set("dateFrom", from);
        if (to) p.set("dateTo", to);
      }
      setData(await api.get<AuditSummary>(`/platform/audit/summary?${p.toString()}`));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load summary");
    } finally {
      setLoading(false);
    }
  }, [window, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Overview
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
            {WINDOWS.map((w) => (
              <button
                key={w.value}
                onClick={() => onWindowChange(w.value)}
                className={`px-3 py-1.5 text-xs font-semibold transition ${
                  window === w.value
                    ? "bg-brand-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
          {window === "custom" && (
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={from}
                onChange={(e) => onCustomChange(e.target.value, to)}
                className="w-40"
                aria-label="Summary from date"
              />
              <span className="text-xs text-slate-400">→</span>
              <Input
                type="date"
                value={to}
                onChange={(e) => onCustomChange(from, e.target.value)}
                className="w-40"
                aria-label="Summary to date"
              />
            </div>
          )}
        </div>
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Total events" value={formatNumber(data.totalEvents)} />
            <StatCard
              label="High-risk & critical"
              value={formatNumber(data.highRiskCount)}
              tone={data.highRiskCount > 0 ? "red" : undefined}
            />
            <StatCard
              label="Failed / blocked"
              value={formatNumber(data.failedBlockedCount)}
              tone={data.failedBlockedCount > 0 ? "amber" : undefined}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {BUCKETS.map((b) => (
              <div
                key={b.key}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"
              >
                <span className="text-sm text-slate-500">{b.label}</span>
                <span className="text-lg font-semibold text-slate-900">
                  {formatNumber(data.buckets[b.key])}
                </span>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <p className="mb-3 text-sm font-semibold text-slate-700">Top actors</p>
              {data.topActors.length === 0 ? (
                <p className="text-xs text-slate-400">No activity in this window.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.topActors.map((a) => (
                    <li
                      key={a.actorEmail}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <button
                        onClick={() => onActorClick("q", a.actorEmail)}
                        className="min-w-0 truncate text-left text-brand-600 hover:text-brand-700"
                        title={`Filter by ${a.actorEmail}`}
                      >
                        {a.actorEmail}
                      </button>
                      <span className="shrink-0 font-mono text-xs text-slate-500">
                        {formatNumber(a.count)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <p className="mb-3 text-sm font-semibold text-slate-700">Top tenants</p>
              {data.topTenants.length === 0 ? (
                <p className="text-xs text-slate-400">No tenant-scoped activity.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.topTenants.map((t) => (
                    <li
                      key={`${t.institutionCode}-${t.institutionName}`}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="min-w-0 truncate text-slate-600">
                        {t.institutionName}{" "}
                        <span className="text-slate-400">({t.institutionCode})</span>
                      </span>
                      <span className="shrink-0 font-mono text-xs text-slate-500">
                        {formatNumber(t.count)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card>
            <p className="mb-3 text-sm font-semibold text-slate-700">
              Recent critical events
            </p>
            {data.recentCritical.length === 0 ? (
              <p className="text-xs text-slate-400">
                No critical events in this window.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.recentCritical.map((row) => (
                  <li key={row.id}>
                    <button
                      onClick={() => onOpenEvent(row.id)}
                      className="flex w-full items-center gap-3 py-2 text-left hover:bg-slate-50"
                    >
                      <Badge tone={severityTone(row.severity)}>
                        {severityLabel(row.severity)}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700">
                        {row.action}
                      </span>
                      <span className="hidden shrink-0 text-xs text-slate-400 sm:block">
                        {row.actorEmail ?? "—"}
                      </span>
                      <span className="shrink-0 text-xs text-slate-400">
                        {formatDateTime(row.createdAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : (
        !error && <EmptyState message="No summary available." />
      )}
    </section>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "red" | "amber";
}) {
  const valueColor =
    tone === "red"
      ? "text-red-600"
      : tone === "amber"
        ? "text-amber-600"
        : "text-slate-900";
  return (
    <Card>
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${valueColor}`}>{value}</p>
    </Card>
  );
}
