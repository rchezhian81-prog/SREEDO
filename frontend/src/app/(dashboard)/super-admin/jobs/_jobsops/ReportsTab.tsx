"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Select, Spinner } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import type { JobReports, JobWindow, JobsIntegrations, RetryPolicySummary } from "@/types";
import { formatNumber } from "../../platform/_utils";
import { SectionHeading, StatCard, WindowSelector } from "./OverviewTab";
import {
  JOB_FILTER_STATUSES,
  SOURCE_MODULES,
  formatDateTime,
  formatDuration,
  isUuid,
  jobStatusLabel,
  runStatusTone,
  shortId,
  superAdminHref,
} from "./taxonomy";

interface Filters {
  status: string;
  module: string;
  type: string;
  queue: string;
  workerId: string;
  institutionId: string;
}

const EMPTY: Filters = { status: "", module: "", type: "", queue: "", workerId: "", institutionId: "" };

export function ReportsTab({ reloadKey }: { reloadKey: number }) {
  const [window, setWindow] = useState<JobWindow>("30d");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY);

  const [reports, setReports] = useState<JobReports | null>(null);
  const [policy, setPolicy] = useState<RetryPolicySummary | null>(null);
  const [integrations, setIntegrations] = useState<JobsIntegrations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const patch = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("window", window);
    if (window === "custom") {
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
    }
    if (filters.status) p.set("status", filters.status);
    if (filters.module) p.set("module", filters.module);
    if (filters.type.trim()) p.set("type", filters.type.trim());
    if (filters.queue.trim()) p.set("queue", filters.queue.trim());
    if (filters.workerId.trim()) p.set("workerId", filters.workerId.trim());
    if (isUuid(filters.institutionId)) p.set("institutionId", filters.institutionId.trim());
    return p.toString();
  }, [window, dateFrom, dateTo, filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, pol, integ] = await Promise.all([
        api.get<JobReports>(`/jobs-ops/reports?${query}`),
        api.get<RetryPolicySummary>("/jobs-ops/retry-policy").catch(() => null),
        api.get<JobsIntegrations>("/jobs-ops/integrations").catch(() => null),
      ]);
      setReports(r);
      setPolicy(pol);
      setIntegrations(integ);
    } catch (err) {
      setReports(null);
      setError(err instanceof ApiError ? err.message : "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  return (
    <section className="space-y-6">
      {/* Filters */}
      <Card className="space-y-3">
        <WindowSelector
          value={window}
          onValue={setWindow}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFrom={setDateFrom}
          onDateTo={setDateTo}
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select value={filters.status} onChange={(e) => patch({ status: e.target.value })} aria-label="Status">
            <option value="">All statuses</option>
            {JOB_FILTER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {jobStatusLabel(s)}
              </option>
            ))}
          </Select>
          <Select value={filters.module} onChange={(e) => patch({ module: e.target.value })} aria-label="Module">
            <option value="">All modules</option>
            {SOURCE_MODULES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
          <Input value={filters.type} onChange={(e) => patch({ type: e.target.value })} placeholder="Job type (exact)" aria-label="Job type" />
          <Input value={filters.queue} onChange={(e) => patch({ queue: e.target.value })} placeholder="Queue" aria-label="Queue" />
          <Input value={filters.workerId} onChange={(e) => patch({ workerId: e.target.value })} placeholder="Worker id" aria-label="Worker id" />
          <Field label="Tenant UUID" error={filters.institutionId && !isUuid(filters.institutionId) ? "Enter a full UUID" : undefined}>
            <Input
              value={filters.institutionId}
              onChange={(e) => patch({ institutionId: e.target.value })}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => setFilters(EMPTY)}>
            Reset filters
          </Button>
        </div>
      </Card>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : reports ? (
        <>
          {/* Status summary */}
          <div>
            <SectionHeading>Status summary</SectionHeading>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <StatCard label="Pending" value={formatNumber(reports.statusSummary.pending)} />
              <StatCard label="Running" value={formatNumber(reports.statusSummary.running)} />
              <StatCard label="Completed" value={formatNumber(reports.statusSummary.success)} />
              <StatCard
                label="Failed"
                value={formatNumber(reports.statusSummary.failed)}
                tone={reports.statusSummary.failed > 0 ? "red" : undefined}
              />
              <StatCard label="Cancelled" value={formatNumber(reports.statusSummary.cancelled)} />
              <StatCard
                label="Dead-letter"
                value={formatNumber(reports.statusSummary.dead_letter)}
                tone={reports.statusSummary.dead_letter > 0 ? "red" : undefined}
              />
            </div>
          </div>

          {/* Queue depth */}
          <div>
            <SectionHeading>Queue depth (live)</SectionHeading>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard label="Pending" value={formatNumber(reports.queueDepth.pending)} />
              <StatCard label="Running" value={formatNumber(reports.queueDepth.running)} />
              <StatCard label="Total" value={formatNumber(reports.queueDepth.total)} />
            </div>
          </div>

          {/* Two-column reports */}
          <div className="grid gap-6 lg:grid-cols-2">
            <CountTable title="Volume by type" head="Type" rows={reports.volumeByType.map((r) => ({ label: r.type, value: r.count }))} />
            <CountTable
              title="Module-wise"
              head="Module"
              rows={reports.moduleWise.map((r) => ({ label: r.module, value: r.count, extra: r.failed }))}
              extraHead="Failed"
            />
            <CountTable title="Failures by type" head="Type" rows={reports.failureReport.map((r) => ({ label: r.type, value: r.failures }))} tone="red" />
            <CountTable title="Retries by type" head="Type" rows={reports.retryReport.map((r) => ({ label: r.type, value: r.retries }))} tone="amber" />
            <CountTable
              title="Dead-letter by type"
              head="Type"
              rows={reports.deadLetterReport.map((r) => ({ label: r.type, value: r.count }))}
              tone="red"
            />
            <SchedulerRunTable rows={reports.schedulerRunReport} />
          </div>

          {/* Long-running jobs */}
          <div>
            <SectionHeading>Long-running jobs</SectionHeading>
            {reports.longRunningJobs.length === 0 ? (
              <EmptyState message="No long-running jobs." />
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                    <tr>
                      <th className="px-4 py-3">Job</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Started</th>
                      <th className="px-4 py-3 text-right">Running for</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {reports.longRunningJobs.map((j) => (
                      <tr key={j.id} className="hover:bg-hover">
                        <td className="px-4 py-3 font-mono text-xs text-muted">{shortId(j.id)}</td>
                        <td className="px-4 py-3 text-ink">{j.type}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-faint">{formatDateTime(j.startedAt)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-amber-600">{formatDuration(j.ageMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Worker performance */}
          <div>
            <SectionHeading>Worker performance</SectionHeading>
            {reports.workerPerformance.length === 0 ? (
              <EmptyState message="No worker performance data." />
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                    <tr>
                      <th className="px-4 py-3">Worker</th>
                      <th className="px-4 py-3 text-right">Processed</th>
                      <th className="px-4 py-3 text-right">Failed</th>
                      <th className="px-4 py-3">Last heartbeat</th>
                      <th className="px-4 py-3">Host / version</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {reports.workerPerformance.map((w) => (
                      <tr key={w.workerId} className="hover:bg-hover">
                        <td className="px-4 py-3 font-mono text-xs text-ink">{w.workerId}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-muted">{formatNumber(w.jobsProcessed)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <span className={w.jobsFailed > 0 ? "text-amber-600" : "text-muted"}>{formatNumber(w.jobsFailed)}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-faint">{formatDateTime(w.lastHeartbeatAt)}</td>
                        <td className="px-4 py-3 text-xs text-faint">
                          {w.hostname ?? "—"}
                          {w.version ? ` · ${w.version}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Retry policy */}
          {policy && <RetryPolicyCard policy={policy} />}

          {/* Integrations */}
          {integrations && <IntegrationsSection data={integrations} />}
        </>
      ) : (
        !error && <EmptyState message="No report data available." />
      )}
    </section>
  );
}

// ---- generic count table ---------------------------------------------------

function CountTable({
  title,
  head,
  rows,
  tone,
  extraHead,
}: {
  title: string;
  head: string;
  rows: { label: string; value: number; extra?: number }[];
  tone?: "red" | "amber";
  extraHead?: string;
}) {
  const valueColor = tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : "text-ink";
  return (
    <Card className="p-0">
      <div className="border-b border-line px-4 py-3">
        <p className="text-sm font-semibold text-ink">{title}</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted">No data.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-2.5">{head}</th>
              {extraHead && <th className="px-4 py-2.5 text-right">{extraHead}</th>}
              <th className="px-4 py-2.5 text-right">Count</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.label} className="hover:bg-hover">
                <td className="px-4 py-2.5 text-ink">{r.label}</td>
                {extraHead && (
                  <td className="px-4 py-2.5 text-right">
                    <span className={r.extra && r.extra > 0 ? "text-amber-600" : "text-muted"}>
                      {formatNumber(r.extra ?? 0)}
                    </span>
                  </td>
                )}
                <td className={`px-4 py-2.5 text-right font-medium ${valueColor}`}>{formatNumber(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function SchedulerRunTable({ rows }: { rows: JobReports["schedulerRunReport"] }) {
  return (
    <Card className="p-0">
      <div className="border-b border-line px-4 py-3">
        <p className="text-sm font-semibold text-ink">Scheduler runs</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted">No scheduler runs in this window.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-2.5">Type</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Count</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => (
              <tr key={`${r.type}-${r.status}-${i}`} className="hover:bg-hover">
                <td className="px-4 py-2.5 text-ink">{r.type}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={runStatusTone(r.status)}>{jobStatusLabel(r.status)}</Badge>
                </td>
                <td className="px-4 py-2.5 text-right font-medium text-ink">{formatNumber(r.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ---- retry policy ----------------------------------------------------------

function RetryPolicyCard({ policy }: { policy: RetryPolicySummary }) {
  return (
    <div>
      <SectionHeading>Retry policy (read-only)</SectionHeading>
      <Card className="space-y-4">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge tone="blue">Max {formatNumber(policy.default.maxAttempts)} attempts</Badge>
          <Badge tone="slate">{policy.default.backoffStrategy} backoff</Badge>
          <Badge tone="slate">base {formatNumber(policy.default.backoffBaseMs)} ms</Badge>
          <Badge tone="slate">{policy.default.formula}</Badge>
        </div>
        {policy.perType.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Module</th>
                  <th className="px-4 py-2.5 text-right">Max attempts</th>
                  <th className="px-4 py-2.5 text-right">Jobs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {policy.perType.map((r) => (
                  <tr key={r.type} className="hover:bg-hover">
                    <td className="px-4 py-2.5 text-ink">{r.type}</td>
                    <td className="px-4 py-2.5 text-muted">{r.module}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-muted">
                      {r.minMaxAttempts === r.maxMaxAttempts
                        ? formatNumber(r.minMaxAttempts)
                        : `${formatNumber(r.minMaxAttempts)}–${formatNumber(r.maxMaxAttempts)}`}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-muted">{formatNumber(r.jobs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-faint">{policy.note}</p>
      </Card>
    </div>
  );
}

// ---- integrations ----------------------------------------------------------

function IntegrationsSection({ data }: { data: JobsIntegrations }) {
  return (
    <div>
      <SectionHeading>Integrations</SectionHeading>
      <div className="grid gap-4 sm:grid-cols-3">
        <IntegrationCard icon="health" title="Observability" href={superAdminHref(data.links.observability)}>
          {"unavailable" in data.observability ? (
            <Unavailable />
          ) : (
            <>
              <DataRow label="Queue depth" value={formatNumber(data.observability.queue.pending + data.observability.queue.running)} />
              <DataRow
                label="Stuck"
                value={formatNumber(data.observability.stuck)}
                tone={data.observability.stuck > 0 ? "red" : undefined}
              />
              <DataRow
                label="Processed (ok/fail)"
                value={`${formatNumber(data.observability.processed.success)} / ${formatNumber(data.observability.processed.failed)}`}
              />
              <DataRow label="Worker" value={data.observability.workerEnabled ? "Enabled" : "On-demand"} />
            </>
          )}
        </IntegrationCard>

        <IntegrationCard icon="clipboard" title="Audit" href={superAdminHref(data.links.audit)}>
          <DataRow label="Job actions (24h)" value={formatNumber(data.audit.jobActions24h)} />
        </IntegrationCard>

        <IntegrationCard icon="shieldCheck" title="Security" href={superAdminHref(data.links.security)}>
          <DataRow
            label="Critical job alerts"
            value={formatNumber(data.security.criticalJobAlerts)}
            tone={data.security.criticalJobAlerts > 0 ? "red" : undefined}
          />
        </IntegrationCard>
      </div>
    </div>
  );
}

function IntegrationCard({
  icon,
  title,
  href,
  children,
}: {
  icon: IconName;
  title: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name={icon} className="h-4 w-4 text-muted" />
          <p className="text-sm font-semibold text-ink">{title}</p>
        </div>
        <Link href={href}>
          <Button variant="secondary" className="!px-3 !py-1.5">
            View
            <Icon name="arrowRight" className="h-4 w-4" />
          </Button>
        </Link>
      </div>
      <dl className="space-y-2 text-sm">{children}</dl>
    </Card>
  );
}

function DataRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "red" | "amber";
}) {
  const color = tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : "text-ink";
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className={`font-medium ${color}`}>{value}</dd>
    </div>
  );
}

function Unavailable() {
  return (
    <div className="flex items-center gap-2">
      <Badge tone="slate">Unavailable</Badge>
      <span className="text-xs text-faint">This integration could not be read.</span>
    </div>
  );
}
