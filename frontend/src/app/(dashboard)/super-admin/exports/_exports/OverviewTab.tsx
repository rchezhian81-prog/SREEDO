"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorNote, Input, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { ExportSummary } from "@/types";
import { formatBytes, formatNumber } from "../../platform/_utils";
import { actionLabel, exportStatusTone, formatDateTime, shortId } from "./taxonomy";

type Chip = "today" | "7d" | "30d" | "custom";
const CHIPS: { value: Chip; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "custom", label: "Custom" },
];

/** YYYY-MM-DD `n` days before today (local time). */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function OverviewTab({
  reloadKey,
  onApplyRange,
}: {
  reloadKey: number;
  onApplyRange: (range: { dateFrom: string; dateTo: string }) => void;
}) {
  const [data, setData] = useState<ExportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [chip, setChip] = useState<Chip>("7d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<ExportSummary>("/exports/summary"));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load export summary");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const applyChip = (c: Chip) => {
    setChip(c);
    if (c === "custom") return;
    const today = daysAgo(0);
    const dateFrom = c === "today" ? today : c === "7d" ? daysAgo(7) : daysAgo(30);
    onApplyRange({ dateFrom, dateTo: today });
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Data export overview
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-faint">View in history:</span>
          <div className="inline-flex overflow-hidden rounded-lg border border-line">
            {CHIPS.map((c) => (
              <button
                key={c.value}
                onClick={() => applyChip(c.value)}
                className={`px-3 py-1.5 text-xs font-semibold transition ${
                  chip === c.value ? "bg-brand-600 text-white" : "bg-surface text-muted hover:bg-hover"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          {chip === "custom" && (
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-40"
                aria-label="From date"
              />
              <span className="text-xs text-faint">→</span>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-40"
                aria-label="To date"
              />
              <Button
                variant="secondary"
                onClick={() => onApplyRange({ dateFrom: from, dateTo: to })}
                disabled={!from && !to}
              >
                Apply
              </Button>
            </div>
          )}
        </div>
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : data ? (
        <>
          {(data.pendingApproval > 0 || data.nearingExpiry > 0) && (
            <div
              role="status"
              className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-700 dark:text-amber-300"
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Icon name="shieldAlert" className="h-4 w-4" />
                Attention needed
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-6 text-sm">
                {data.pendingApproval > 0 && (
                  <li>
                    {formatNumber(data.pendingApproval)} export
                    {data.pendingApproval === 1 ? "" : "s"} awaiting a second super-admin&apos;s approval.
                  </li>
                )}
                {data.nearingExpiry > 0 && (
                  <li>
                    {formatNumber(data.nearingExpiry)} completed export
                    {data.nearingExpiry === 1 ? "" : "s"} nearing retention expiry — download soon.
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* Prominent headline panel */}
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-muted">Latest export</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {data.latestStatus ? (
                    <Badge tone={exportStatusTone(data.latestStatus)}>{data.latestStatus}</Badge>
                  ) : (
                    <Badge tone="slate">No exports yet</Badge>
                  )}
                  <Badge tone="slate">{formatNumber(data.today)} created today</Badge>
                </div>
                <p className="mt-2 text-sm text-ink">
                  {formatNumber(data.totals.total)} total export
                  {data.totals.total === 1 ? "" : "s"} on record
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-muted">Storage used</p>
                <p className="mt-1 text-2xl font-semibold text-ink">
                  {formatBytes(data.storageUsedBytes)}
                </p>
                <p className="mt-1 text-xs text-faint">
                  {formatNumber(data.downloads)} download{data.downloads === 1 ? "" : "s"} served
                </p>
              </div>
            </div>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total exports" value={formatNumber(data.totals.total)} />
            <StatCard label="Created today" value={formatNumber(data.today)} />
            <StatCard
              label="Running"
              value={formatNumber(data.totals.running)}
              tone={data.totals.running > 0 ? "amber" : undefined}
            />
            <StatCard label="Completed" value={formatNumber(data.totals.completed)} tone="green" />
            <StatCard
              label="Failed"
              value={formatNumber(data.totals.failed)}
              tone={data.totals.failed > 0 ? "red" : undefined}
            />
            <StatCard label="Expired" value={formatNumber(data.totals.expired)} />
            <StatCard
              label="Sensitive exports"
              value={formatNumber(data.sensitive)}
              sub={<span className="text-xs text-faint">Personal / security data</span>}
            />
            <StatCard
              label="Pending approval"
              value={formatNumber(data.pendingApproval)}
              tone={data.pendingApproval > 0 ? "amber" : undefined}
            />
            <StatCard
              label="Nearing expiry"
              value={formatNumber(data.nearingExpiry)}
              tone={data.nearingExpiry > 0 ? "amber" : undefined}
            />
            <StatCard
              label="Portability packs"
              value={formatNumber(data.portabilityPacks)}
              sub={<span className="text-xs text-faint">Per-tenant ZIP packs</span>}
            />
            <StatCard
              label="Scheduled exports"
              value={formatNumber(data.schedules.total)}
              sub={
                <Badge tone={data.schedules.enabled > 0 ? "green" : "slate"}>
                  {formatNumber(data.schedules.enabled)} enabled
                </Badge>
              }
            />
            <StatCard label="Downloads served" value={formatNumber(data.downloads)} />
          </div>

          {/* Recent export audit events */}
          <Card className="p-0">
            <div className="border-b border-line px-5 py-3">
              <p className="text-sm font-semibold text-ink">Recent export activity</p>
            </div>
            {data.recentEvents.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">No export activity recorded yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.recentEvents.map((e, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge tone="blue">{actionLabel(e.action)}</Badge>
                      <span className="truncate text-muted">{e.actorEmail ?? "system"}</span>
                      {e.targetId && (
                        <span className="font-mono text-xs text-faint">{shortId(e.targetId)}</span>
                      )}
                    </div>
                    <span className="text-xs text-faint">{formatDateTime(e.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : (
        !error && <EmptyState message="No export summary available." />
      )}
    </section>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
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
      <div className={`mt-1 text-2xl font-semibold ${valueColor}`}>{value}</div>
      {sub && <div className="mt-1.5">{sub}</div>}
    </Card>
  );
}
