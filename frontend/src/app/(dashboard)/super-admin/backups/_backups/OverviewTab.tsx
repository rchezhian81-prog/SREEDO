"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorNote, Input, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { BackupSummary } from "@/types";
import { formatBytes, formatNumber } from "../../platform/_utils";
import {
  backupStatusTone,
  checksumLabel,
  formatDateTime,
  restoreStatusTone,
  titleCase,
  triggerLabel,
} from "./taxonomy";

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
  const [data, setData] = useState<BackupSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [chip, setChip] = useState<Chip>("7d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<BackupSummary>("/backups/summary"));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load backup summary");
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
          Backup &amp; recovery overview
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-faint">View in history:</span>
          <div className="inline-flex overflow-hidden rounded-lg border border-line">
            {CHIPS.map((c) => (
              <button
                key={c.value}
                onClick={() => applyChip(c.value)}
                className={`px-3 py-1.5 text-xs font-semibold transition ${
                  chip === c.value
                    ? "bg-brand-600 text-white"
                    : "bg-surface text-muted hover:bg-hover"
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
          {data.warnings.length > 0 && (
            <div
              role="alert"
              className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-700 dark:text-amber-300"
            >
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Icon name="alert" className="h-4 w-4" />
                {data.warnings.length} issue{data.warnings.length === 1 ? "" : "s"} need attention
              </div>
              <ul className="list-disc space-y-1 pl-6 text-sm">
                {data.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Prominent last-backup panel */}
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-muted">Last backup</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {data.lastBackup ? (
                    <>
                      <Badge tone={backupStatusTone(data.lastBackup.status)}>
                        {data.lastBackup.status}
                      </Badge>
                      <Badge tone="slate">{triggerLabel(data.lastBackup.trigger)}</Badge>
                    </>
                  ) : (
                    <Badge tone="slate">No backups yet</Badge>
                  )}
                </div>
                <p className="mt-2 text-sm text-ink">
                  {formatDateTime(data.lastBackup?.createdAt ?? data.lastSuccessAt)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-muted">Size</p>
                <p className="mt-1 text-2xl font-semibold text-ink">
                  {formatBytes(
                    data.lastBackup?.sizeBytes ?? data.lastSuccessSizeBytes ?? 0
                  )}
                </p>
                <p className="mt-1 text-xs text-faint">
                  Last success: {formatDateTime(data.lastSuccessAt)}
                </p>
              </div>
            </div>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Next scheduled run"
              value={data.schedule.enabled ? formatDateTime(data.schedule.nextRunAt) : "Off"}
              sub={
                <Badge tone={data.schedule.enabled ? "green" : "slate"}>
                  {data.schedule.enabled ? `Schedule on · ${data.schedule.frequency}` : "Schedule off"}
                </Badge>
              }
            />
            <StatCard
              label="Retention policy"
              value={
                data.retention.retentionCount == null
                  ? "Keep all"
                  : `Keep latest ${formatNumber(data.retention.retentionCount)}`
              }
              sub={
                <span className="text-xs text-faint">
                  Rollback window: {formatNumber(data.retention.retentionMinKeep ?? 0)}
                </span>
              }
            />
            <StatCard
              label="Storage used"
              value={formatBytes(data.storageUsedBytes ?? 0)}
            />
            <StatCard
              label="Total backups"
              value={formatNumber(data.totals.total)}
              sub={
                <span className="text-xs text-faint">
                  {formatNumber(data.totals.available)} available ·{" "}
                  {formatNumber(data.totals.archived)} archived
                </span>
              }
            />
            <StatCard
              label="Failed backups"
              value={formatNumber(data.totals.failed)}
              tone={data.totals.failed > 0 ? "red" : undefined}
            />
            <StatCard
              label="Checksum integrity"
              value={`${formatNumber(data.integrity.checksumVerified)} verified`}
              tone={data.integrity.checksumFailed > 0 ? "red" : "green"}
              sub={
                <span className="text-xs text-faint">
                  {formatNumber(data.integrity.checksumFailed)} {checksumLabel("failed").toLowerCase()}
                </span>
              }
            />
            <StatCard
              label="Off-site copies"
              value={formatNumber(data.offsite.copies)}
              tone={data.offsite.configured ? "green" : undefined}
              sub={
                <Badge tone={data.offsite.configured ? "green" : "slate"}>
                  {data.offsite.configured ? `Configured · ${data.offsite.mode}` : "Not configured"}
                </Badge>
              }
            />
            <StatCard
              label="Encryption at rest"
              value={data.encryption.enabled ? "Enabled" : "Not enabled"}
              tone={data.encryption.enabled ? "green" : "amber"}
              sub={
                !data.encryption.enabled ? (
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    Documented limitation
                  </span>
                ) : undefined
              }
            />
            <StatCard
              label="Pending restore requests"
              value={formatNumber(data.restore.pendingRequests)}
              tone={data.restore.pendingRequests > 0 ? "amber" : undefined}
            />
            <StatCard
              label="Latest restore"
              value={
                data.restore.latestStatus ? (
                  <Badge tone={restoreStatusTone(data.restore.latestStatus)}>
                    {titleCase(data.restore.latestStatus)}
                  </Badge>
                ) : (
                  "None"
                )
              }
              sub={
                <span className="text-xs text-faint">{formatDateTime(data.restore.latestAt)}</span>
              }
            />
          </div>
        </>
      ) : (
        !error && <EmptyState message="No backup summary available." />
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
