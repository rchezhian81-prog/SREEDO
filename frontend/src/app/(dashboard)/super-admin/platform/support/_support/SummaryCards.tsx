"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { Badge, Card, EmptyState, ErrorNote, Input, Spinner } from "@/components/ui";
import type { SupportSummary } from "@/types";
import { useNow } from "@/lib/use-now";
import { formatNumber } from "../../_utils";
import {
  formatCountdown,
  formatDateTime,
  formatDuration,
  humanizeToken,
  scopeLabel,
  scopeTone,
} from "./taxonomy";

type Win = SupportSummary["window"];
const WINDOWS: { value: Win; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "custom", label: "Custom" },
];

const AUDIT_LINK = "/super-admin/platform/audit?q=support";

export function SummaryCards({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const [win, setWin] = useState<Win>("7d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<SupportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(1000);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ window: win });
      if (win === "custom") {
        if (from) p.set("dateFrom", from);
        if (to) p.set("dateTo", to);
      }
      setData(await api.get<SupportSummary>(`/platform/support/summary?${p.toString()}`));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load summary");
    } finally {
      setLoading(false);
    }
  }, [win, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Support access overview
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-line">
            {WINDOWS.map((w) => (
              <button
                key={w.value}
                onClick={() => setWin(w.value)}
                className={`px-3 py-1.5 text-xs font-semibold transition ${
                  win === w.value
                    ? "bg-brand-600 text-white"
                    : "bg-surface text-muted hover:bg-hover"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
          {win === "custom" && (
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-40"
                aria-label="Summary from date"
              />
              <span className="text-xs text-faint">→</span>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Active now" value={formatNumber(data.activeCount)} tone={data.activeCount > 0 ? "green" : undefined} />
            <StatCard label="High-risk active" value={formatNumber(data.highRiskCount)} tone={data.highRiskCount > 0 ? "red" : undefined} />
            <StatCard label="Started today" value={formatNumber(data.startedToday)} />
            <StatCard label="Avg duration" value={formatDuration(Math.round(data.avgDurationMinutes))} />
            <StatCard label="Ended today" value={formatNumber(data.endedToday)} />
            <StatCard label="Expired today" value={formatNumber(data.expiredToday)} tone={data.expiredToday > 0 ? "amber" : undefined} />
            <StatCard label="Revoked today" value={formatNumber(data.revokedToday)} tone={data.revokedToday > 0 ? "red" : undefined} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <p className="mb-3 text-sm font-semibold text-ink">Sessions by operator</p>
              {data.byOperator.length === 0 ? (
                <p className="text-xs text-faint">No sessions in this window.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.byOperator.map((o) => (
                    <li
                      key={o.operatorId ?? o.operatorEmail ?? "unknown"}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="min-w-0 truncate text-muted">{o.operatorEmail ?? "—"}</span>
                      <span className="shrink-0 font-mono text-xs text-faint">{formatNumber(o.sessions)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <p className="mb-3 text-sm font-semibold text-ink">Sessions by tenant</p>
              {data.byTenant.length === 0 ? (
                <p className="text-xs text-faint">No tenant-scoped sessions.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.byTenant.map((t) => (
                    <li
                      key={t.institutionId ?? `${t.institutionCode}-${t.institutionName}`}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="min-w-0 truncate text-muted">
                        {t.institutionName ?? "—"}{" "}
                        {t.institutionCode && <span className="text-faint">({t.institutionCode})</span>}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-faint">{formatNumber(t.sessions)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card>
            <p className="mb-3 text-sm font-semibold text-ink">Nearing expiry (next 5 min)</p>
            {data.nearingExpiry.length === 0 ? (
              <p className="text-xs text-faint">No sessions are about to expire.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.nearingExpiry.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => onOpenSession(s.id)}
                      className="flex w-full flex-wrap items-center gap-3 py-2 text-left hover:bg-hover"
                    >
                      <Badge tone={scopeTone(s.scope)}>{scopeLabel(s.scope)}</Badge>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{s.targetEmail}</span>
                      <span className="shrink-0 text-xs text-muted">{s.institutionName ?? "—"}</span>
                      <span className="shrink-0 font-mono text-xs font-semibold text-amber-600">
                        {s.expiresAt ? formatCountdown(new Date(s.expiresAt).getTime(), now) : "—"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink">Recent support audit events</p>
              <Link href={AUDIT_LINK} className="text-xs font-medium text-brand-600 hover:text-brand-700">
                Open in Audit Console →
              </Link>
            </div>
            {data.recentAuditEvents.length === 0 ? (
              <p className="text-xs text-faint">No recent support events.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.recentAuditEvents.map((e) => (
                  <li key={e.id}>
                    <Link
                      href={AUDIT_LINK}
                      className="flex flex-wrap items-center gap-3 py-2 hover:bg-hover"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">
                        {humanizeToken(e.action.replace(/^support\.|^impersonate\./, ""))}
                      </span>
                      <span className="hidden shrink-0 text-xs text-faint sm:block">{e.actorEmail ?? "—"}</span>
                      <span className="shrink-0 text-xs text-faint">{formatDateTime(e.createdAt)}</span>
                    </Link>
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
  tone?: "green" | "red" | "amber";
}) {
  const valueColor =
    tone === "red"
      ? "text-red-600"
      : tone === "amber"
        ? "text-amber-600"
        : tone === "green"
          ? "text-emerald-600"
          : "text-ink";
  return (
    <Card>
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${valueColor}`}>{value}</p>
    </Card>
  );
}
