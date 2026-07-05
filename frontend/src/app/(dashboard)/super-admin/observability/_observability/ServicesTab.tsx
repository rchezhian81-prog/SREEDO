"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorNote, Modal, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type {
  OpsJobsHealth,
  OpsServiceDetail,
  OpsServiceList,
  OpsSmtpHealth,
  OpsUptime,
} from "@/types";
import { formatNumber } from "../../platform/_utils";
import {
  formatDateTime,
  formatMs,
  formatPct,
  serviceStatusTone,
  superAdminHref,
  titleCase,
} from "./taxonomy";

type UptimeWindow = "24h" | "7d" | "30d";
const WINDOWS: UptimeWindow[] = ["24h", "7d", "30d"];

export function ServicesTab({
  reloadKey,
  onChanged,
}: {
  reloadKey: number;
  onChanged: () => void;
}) {
  const [list, setList] = useState<OpsServiceList | null>(null);
  const [smtp, setSmtp] = useState<OpsSmtpHealth | null>(null);
  const [jobs, setJobs] = useState<OpsJobsHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [localReload, setLocalReload] = useState(0);

  const [uptimeWindow, setUptimeWindow] = useState<UptimeWindow>("7d");
  const [uptime, setUptime] = useState<OpsUptime | null>(null);
  const [uptimeError, setUptimeError] = useState<string | null>(null);

  const [detailName, setDetailName] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [l, s, j] = await Promise.all([
        api.get<OpsServiceList>("/observability/services"),
        api.get<OpsSmtpHealth>("/observability/smtp").catch(() => null),
        api.get<OpsJobsHealth>("/observability/jobs-health").catch(() => null),
      ]);
      setList(l);
      setSmtp(s);
      setJobs(j);
    } catch (err) {
      setList(null);
      setError(err instanceof ApiError ? err.message : "Failed to load service health");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey, localReload]);

  const loadUptime = useCallback(async () => {
    setUptimeError(null);
    try {
      setUptime(await api.get<OpsUptime>(`/observability/uptime?window=${uptimeWindow}`));
    } catch (err) {
      setUptime(null);
      setUptimeError(err instanceof ApiError ? err.message : "Failed to load uptime");
    }
  }, [uptimeWindow]);

  useEffect(() => {
    loadUptime();
  }, [loadUptime, reloadKey, localReload]);

  const runChecks = async () => {
    setRunning(true);
    try {
      await api.post<OpsServiceList>("/observability/services/run");
      toast.success("Service health checks run.");
      setLocalReload((k) => k + 1);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to run checks");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Service health</h2>
        <Button onClick={runChecks} disabled={running}>
          <Icon name="health" className="h-4 w-4" />
          {running ? "Running…" : "Run checks now"}
        </Button>
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : list ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted">Overall:</span>
            <Badge tone={serviceStatusTone(list.overall.status)}>{list.overall.status}</Badge>
            <Badge tone="green">{formatNumber(list.overall.healthy)} healthy</Badge>
            <Badge tone="amber">{formatNumber(list.overall.degraded)} degraded</Badge>
            <Badge tone="red">{formatNumber(list.overall.down)} down</Badge>
            <Badge tone="slate">{formatNumber(list.overall.unknown)} unknown</Badge>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Service</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Response</th>
                  <th className="px-4 py-3">Detail</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.services.map((s) => (
                  <tr key={s.service} className="hover:bg-hover">
                    <td className="px-4 py-3 font-medium capitalize text-ink">{s.service}</td>
                    <td className="px-4 py-3">
                      <Badge tone={serviceStatusTone(s.status)}>{s.status}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-muted">
                      {formatMs(s.responseTimeMs)}
                    </td>
                    <td className="max-w-md px-4 py-3 text-muted">
                      <span className="block truncate" title={s.detail}>
                        {s.detail}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <Button
                          variant="secondary"
                          className="!px-3 !py-1.5"
                          onClick={() => setDetailName(s.service)}
                        >
                          History
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        !error && <EmptyState message="No service health available." />
      )}

      {/* Uptime */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Uptime</h2>
          <div className="inline-flex overflow-hidden rounded-lg border border-line">
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setUptimeWindow(w)}
                className={`px-3 py-1.5 text-xs font-semibold transition ${
                  uptimeWindow === w
                    ? "bg-brand-600 text-white"
                    : "bg-surface text-muted hover:bg-hover"
                }`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>

        <ErrorNote message={uptimeError} />

        {uptime ? (
          uptime.services.length === 0 ? (
            <EmptyState message="No uptime history for this window yet." />
          ) : (
            <>
              {uptime.sparse && uptime.note && (
                <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
                  {uptime.note}
                </p>
              )}
              <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                    <tr>
                      <th className="px-4 py-3">Service</th>
                      <th className="px-4 py-3 text-right">Uptime</th>
                      <th className="px-4 py-3 text-right">Avg response</th>
                      <th className="px-4 py-3 text-right">Checks</th>
                      <th className="px-4 py-3">Last checked</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {uptime.services.map((u) => (
                      <tr key={u.service} className="hover:bg-hover">
                        <td className="px-4 py-3 font-medium capitalize text-ink">{u.service}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-muted">
                          {formatPct(u.uptimePct)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-muted">
                          {formatMs(u.avgResponseMs)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-muted">
                          {formatNumber(u.healthy)} / {formatNumber(u.total)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-faint">
                          {formatDateTime(u.lastCheckedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {uptime.degradedPeriods.length > 0 && (
                <Card className="p-0">
                  <div className="border-b border-line px-5 py-3">
                    <p className="text-sm font-semibold text-ink">Recent degraded / down periods</p>
                  </div>
                  <ul className="divide-y divide-line">
                    {uptime.degradedPeriods.map((p, i) => (
                      <li
                        key={i}
                        className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <Badge tone={serviceStatusTone(p.status)}>{p.status}</Badge>
                          <span className="font-medium capitalize text-ink">{p.service}</span>
                          <span className="truncate text-xs text-muted" title={p.detail}>
                            {p.detail}
                          </span>
                        </div>
                        <span className="text-xs text-faint">{formatDateTime(p.checkedAt)}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )
        ) : (
          !uptimeError && <Spinner />
        )}
      </div>

      {/* SMTP + Jobs health */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SmtpCard smtp={smtp} />
        <JobsCard jobs={jobs} />
      </div>

      <ServiceDetailModal name={detailName} onClose={() => setDetailName(null)} />
    </div>
  );
}

function SmtpCard({ smtp }: { smtp: OpsSmtpHealth | null }) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">SMTP health</p>
        {smtp ? (
          <Badge tone={serviceStatusTone(smtp.status)}>{smtp.status}</Badge>
        ) : (
          <Badge tone="slate">unavailable</Badge>
        )}
      </div>
      {smtp ? (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge tone={smtp.configured ? "green" : "slate"}>
              {smtp.configured ? "Configured" : "Not configured"}
            </Badge>
            <Badge tone={smtp.verified ? "green" : "amber"}>
              {smtp.verified ? "Verified" : "Unverified"}
            </Badge>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Metric label="Sent" value={formatNumber(smtp.delivery.sent)} />
            <Metric
              label="Failed"
              value={formatNumber(smtp.delivery.failed)}
              tone={smtp.delivery.failed > 0 ? "red" : undefined}
            />
            <Metric label="Skipped" value={formatNumber(smtp.delivery.skipped)} />
          </div>
          <p className="text-xs text-muted">Failure rate: {smtp.delivery.failureRatePct}%</p>
          {smtp.recentFailedRecipients.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted">Recent failed recipients</p>
              <ul className="space-y-1 text-xs text-muted">
                {smtp.recentFailedRecipients.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-faint">{r.recipient}</span>
                    <span>{r.template}</span>
                    <span className="text-faint">{formatDateTime(r.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {smtp.note && <p className="text-xs text-faint">{smtp.note}</p>}
        </div>
      ) : (
        <p className="text-sm text-muted">SMTP health could not be loaded.</p>
      )}
    </Card>
  );
}

function JobsCard({ jobs }: { jobs: OpsJobsHealth | null }) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">Worker &amp; jobs</p>
        {jobs ? (
          <Badge tone={jobs.workerEnabled ? "green" : "slate"}>
            {jobs.workerEnabled ? "Worker enabled" : "On-demand"}
          </Badge>
        ) : (
          <Badge tone="slate">unavailable</Badge>
        )}
      </div>
      {jobs ? (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Metric label="Pending" value={formatNumber(jobs.queue.pending)} />
            <Metric label="Running" value={formatNumber(jobs.queue.running)} />
            <Metric
              label="Failed"
              value={formatNumber(jobs.queue.failed)}
              tone={jobs.queue.failed > 0 ? "amber" : undefined}
            />
            <Metric label="Success" value={formatNumber(jobs.queue.success)} />
            <Metric label="Cancelled" value={formatNumber(jobs.queue.cancelled)} />
            <Metric
              label="Stuck"
              value={formatNumber(jobs.stuck)}
              tone={jobs.stuck > 0 ? "red" : undefined}
            />
          </div>
          <p className="text-xs text-muted">
            Processed — {formatNumber(jobs.processed.success)} ok ·{" "}
            {formatNumber(jobs.processed.failed)} failed · {formatNumber(jobs.processed.retried)}{" "}
            retried
          </p>
          <Link href={superAdminHref(jobs.link)}>
            <Button variant="secondary" className="!px-3 !py-1.5">
              <Icon name="wrench" className="h-4 w-4" />
              View jobs console
            </Button>
          </Link>
        </div>
      ) : (
        <p className="text-sm text-muted">Jobs health could not be loaded.</p>
      )}
    </Card>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "red" | "amber";
}) {
  const color = tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-2 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-lg font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function ServiceDetailModal({ name, onClose }: { name: string | null; onClose: () => void }) {
  const [data, setData] = useState<OpsServiceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!name) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    setData(null);
    api
      .get<OpsServiceDetail>(`/observability/services/${encodeURIComponent(name)}`)
      .then(setData)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load service detail")
      )
      .finally(() => setLoading(false));
  }, [name]);

  if (!name) return null;

  return (
    <Modal title={`Service: ${name}`} open={name !== null} onClose={onClose}>
      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : data ? (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={serviceStatusTone(data.current.status)}>{data.current.status}</Badge>
            <span className="text-muted">Uptime: {formatPct(data.uptimePct)}</span>
            <span className="text-faint">{formatMs(data.current.responseTimeMs)}</span>
          </div>
          <p className="text-muted">{data.current.detail}</p>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge tone="slate">{formatNumber(data.counts.total)} checks</Badge>
            <Badge tone="green">{formatNumber(data.counts.healthy)} healthy</Badge>
            <Badge tone="amber">{formatNumber(data.counts.degraded)} degraded</Badge>
            <Badge tone="red">{formatNumber(data.counts.down)} down</Badge>
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">History</p>
            {data.history.length === 0 ? (
              <p className="text-muted">No history recorded yet.</p>
            ) : (
              <ul className="max-h-72 divide-y divide-line overflow-auto rounded-lg border border-line">
                {data.history.map((h, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge tone={serviceStatusTone(h.status)}>{titleCase(h.status)}</Badge>
                      <span className="truncate text-muted" title={h.detail}>
                        {h.detail}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-faint">
                      <span>{formatMs(h.responseTimeMs)}</span>
                      <span>{formatDateTime(h.checkedAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
