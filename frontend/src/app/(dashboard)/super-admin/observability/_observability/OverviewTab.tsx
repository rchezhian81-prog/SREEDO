"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Card, EmptyState, ErrorNote, Spinner } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import type { OpsHealthDashboard, OpsServiceCheck } from "@/types";
import type { ObservabilityTab } from "../page";
import { formatBytes, formatNumber } from "../../platform/_utils";
import {
  alertRuleTypeLabel,
  alertStatusTone,
  formatDateTime,
  formatMs,
  serviceStatusTone,
  severityTone,
  titleCase,
} from "./taxonomy";

const BANNER: Record<string, { border: string; icon: IconName; label: string }> = {
  healthy: {
    border: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    icon: "shieldCheck",
    label: "All systems healthy",
  },
  degraded: {
    border: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    icon: "shieldAlert",
    label: "Platform degraded",
  },
  down: {
    border: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
    icon: "alert",
    label: "Platform outage",
  },
};

export function OverviewTab({
  reloadKey,
  onJump,
}: {
  reloadKey: number;
  onJump: (tab: ObservabilityTab) => void;
}) {
  const [data, setData] = useState<OpsHealthDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<OpsHealthDashboard>("/observability/summary"));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load health dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  return (
    <section className="space-y-5">
      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : data ? (
        <>
          <OverallBanner overall={data.overall} />

          {/* Service chips */}
          <div>
            <SectionHeading>Services</SectionHeading>
            {data.services.length === 0 ? (
              <p className="text-sm text-muted">No service checks recorded.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.services.map((s) => (
                  <ServiceChip key={s.service} check={s} />
                ))}
              </div>
            )}
          </div>

          {/* Traffic / queue metrics */}
          <div>
            <SectionHeading>Traffic &amp; queue</SectionHeading>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Requests" value={formatNumber(data.metrics.requestsTotal)} />
              <StatCard
                label="Errors"
                value={formatNumber(data.metrics.errorsTotal)}
                tone={data.metrics.errorsTotal > 0 ? "amber" : undefined}
              />
              <StatCard label="API error rate" value={`${data.metrics.apiErrorRatePct}%`} />
              <StatCard label="Avg response" value={`${formatNumber(data.metrics.avgResponseMs)} ms`} />
              <StatCard label="Queue depth" value={formatNumber(data.metrics.queueDepth)} />
              <StatCard label="Pending jobs" value={formatNumber(data.metrics.pendingJobs)} />
              <StatCard label="Running jobs" value={formatNumber(data.metrics.runningJobs)} />
              <StatCard
                label="Failed jobs today"
                value={formatNumber(data.metrics.failedJobsToday)}
                tone={data.metrics.failedJobsToday > 0 ? "amber" : undefined}
              />
              <StatCard
                label="Stuck jobs"
                value={formatNumber(data.metrics.stuckJobs)}
                tone={data.metrics.stuckJobs > 0 ? "red" : undefined}
              />
            </div>
          </div>

          {/* Incidents / alerts / uptime / backups */}
          <div>
            <SectionHeading>Incidents, alerts &amp; uptime</SectionHeading>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Active incidents"
                value={formatNumber(data.incidents.active)}
                tone={data.incidents.active > 0 ? "amber" : undefined}
                sub={
                  <button
                    onClick={() => onJump("incidents")}
                    className="text-xs font-medium text-brand-600 hover:underline"
                  >
                    View incidents →
                  </button>
                }
              />
              <StatCard
                label="Critical incidents"
                value={formatNumber(data.incidents.critical)}
                tone={data.incidents.critical > 0 ? "red" : undefined}
              />
              <StatCard
                label="Open alerts"
                value={formatNumber(data.alerts.open)}
                tone={data.alerts.open > 0 ? "amber" : undefined}
                sub={
                  <button
                    onClick={() => onJump("alerts")}
                    className="text-xs font-medium text-brand-600 hover:underline"
                  >
                    View alerts →
                  </button>
                }
              />
              <StatCard
                label="Uptime checks (7d)"
                value={`${formatNumber(data.uptime.healthyChecks)} / ${formatNumber(
                  data.uptime.windowChecks
                )}`}
                sub={<span className="text-xs text-faint">healthy / total sweeps</span>}
              />
            </div>
            {data.uptime.note && (
              <p className="mt-2 text-xs text-faint">{data.uptime.note}</p>
            )}
          </div>

          {/* Backup storage */}
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-muted">Backups</p>
                <p className="mt-1 text-sm text-ink">
                  Last success: {formatDateTime(data.backupStorage.lastSuccessAt)}
                </p>
                <div className="mt-2">
                  {data.backupStorage.failed > 0 ? (
                    <Badge tone="red">{formatNumber(data.backupStorage.failed)} failed</Badge>
                  ) : (
                    <Badge tone="green">No failures</Badge>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-muted">Backup storage</p>
                <p className="mt-1 text-2xl font-semibold text-ink">
                  {formatBytes(data.backupStorage.storageUsedBytes)}
                </p>
              </div>
            </div>
          </Card>

          {/* Recent alerts */}
          <Card className="p-0">
            <div className="border-b border-line px-5 py-3">
              <p className="text-sm font-semibold text-ink">Recent alerts</p>
            </div>
            {data.alerts.recent.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">No alerts recorded yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.alerts.recent.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-ink">{a.ruleName}</span>
                      <Badge tone={severityTone(a.severity)}>{titleCase(a.severity)}</Badge>
                      <Badge tone={alertStatusTone(a.status)}>{titleCase(a.status)}</Badge>
                      <span className="text-xs text-muted">{alertRuleTypeLabel(a.type)}</span>
                      {a.service && <span className="text-xs text-faint">· {a.service}</span>}
                    </div>
                    <span className="text-xs text-faint">{formatDateTime(a.triggeredAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {data.deploy.note && <p className="text-xs text-faint">{data.deploy.note}</p>}
        </>
      ) : (
        !error && <EmptyState message="No health data available." />
      )}
    </section>
  );
}

function OverallBanner({ overall }: { overall: OpsHealthDashboard["overall"] }) {
  const b = BANNER[overall.status] ?? BANNER.degraded;
  return (
    <div role="status" className={`rounded-2xl border p-4 ${b.border}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Icon name={b.icon} className="h-5 w-5" />
          {b.label}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone="green">{formatNumber(overall.healthy)} healthy</Badge>
          <Badge tone="amber">{formatNumber(overall.degraded)} degraded</Badge>
          <Badge tone="red">{formatNumber(overall.down)} down</Badge>
          <Badge tone="slate">{formatNumber(overall.unknown)} unknown</Badge>
        </div>
      </div>
    </div>
  );
}

function ServiceChip({ check }: { check: OpsServiceCheck }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium capitalize text-ink">{check.service}</span>
        <Badge tone={serviceStatusTone(check.status)}>{check.status}</Badge>
      </div>
      <p className="mt-1 truncate text-xs text-muted" title={check.detail}>
        {check.detail}
      </p>
      {check.responseTimeMs != null && (
        <p className="mt-0.5 text-xs text-faint">{formatMs(check.responseTimeMs)}</p>
      )}
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{children}</h2>
  );
}

export function StatCard({
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
