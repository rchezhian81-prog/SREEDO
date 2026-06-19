"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { ScheduledReport, ScheduledReportRun } from "@/types";
import { formatDateTime, runStatusTone } from "../_utils";

const FREQUENCY_LABELS: Record<ScheduledReport["frequency"], string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

const DAY_OF_WEEK_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const EXPORT_FORMAT_LABELS: Record<
  ScheduledReport["exportFormat"],
  string
> = {
  csv: "CSV",
  pdf: "PDF",
  both: "CSV & PDF",
};

const CHANNEL_LABELS: Record<string, string> = {
  in_app: "In-app",
  email: "Email",
};

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-0.5 text-sm text-slate-900">{value || "—"}</p>
    </div>
  );
}

function scheduleSummary(schedule: ScheduledReport): string {
  if (schedule.frequency === "weekly") {
    const day =
      schedule.dayOfWeek != null
        ? DAY_OF_WEEK_LABELS[schedule.dayOfWeek]
        : "—";
    return `Weekly on ${day} at ${schedule.runTime}`;
  }
  if (schedule.frequency === "monthly") {
    return `Monthly on day ${schedule.dayOfMonth ?? "—"} at ${schedule.runTime}`;
  }
  return `Daily at ${schedule.runTime}`;
}

export default function ScheduledReportDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { can, loading: permsLoading } = usePermissions();
  const canRead = can("scheduled_reports:read");
  const canUpdate = can("scheduled_reports:update");
  const canRun = can("scheduled_reports:run");
  const canHistory = can("scheduled_reports:history");

  const [schedule, setSchedule] = useState<ScheduledReport | null>(null);
  const [runs, setRuns] = useState<ScheduledReportRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const detail = await api.get<ScheduledReport>(
        `/scheduled-reports/${id}`
      );
      setSchedule(detail);
      if (canHistory) {
        try {
          setRuns(
            await api.get<ScheduledReportRun[]>(
              `/scheduled-reports/${id}/runs?limit=25`
            )
          );
        } catch {
          setRuns([]);
        }
      } else {
        setRuns([]);
      }
    } catch (err) {
      setSchedule(null);
      if (err instanceof ApiError && err.status === 404) {
        setLoadError("This scheduled report could not be found.");
      } else {
        setLoadError(
          err instanceof ApiError ? err.message : "Failed to load schedule"
        );
      }
    } finally {
      setLoading(false);
    }
  }, [id, canHistory]);

  useEffect(() => {
    if (!permsLoading && canRead) load();
    else if (!permsLoading) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permsLoading, canRead, id]);

  const onRunNow = async () => {
    setActionError(null);
    setBusy(true);
    try {
      const run = await api.post<ScheduledReportRun>(
        `/scheduled-reports/${id}/run`
      );
      await load();
      if (run.status === "failed") {
        setActionError(
          run.errorMessage ? `Run failed: ${run.errorMessage}` : "Run failed."
        );
      }
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to run schedule"
      );
    } finally {
      setBusy(false);
    }
  };

  const onToggleEnabled = async () => {
    if (!schedule) return;
    setActionError(null);
    setBusy(true);
    try {
      const updated = await api.patch<ScheduledReport>(
        `/scheduled-reports/${id}`,
        { enabled: !schedule.enabled }
      );
      setSchedule(updated);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to update schedule"
      );
    } finally {
      setBusy(false);
    }
  };

  if (permsLoading || loading) {
    return (
      <>
        <PageHeader title="Schedule" subtitle="Scheduled report" />
        <Spinner />
      </>
    );
  }

  if (!canRead) {
    return (
      <>
        <PageHeader title="Schedule" subtitle="Scheduled report" />
        <EmptyState message="You don't have access to scheduled reports." />
      </>
    );
  }

  if (loadError || !schedule) {
    return (
      <>
        <PageHeader title="Schedule" subtitle="Scheduled report" />
        <div className="mb-4">
          <Link
            href="/scheduled-reports"
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            ← Back to Scheduled Reports
          </Link>
        </div>
        <ErrorNote message={loadError ?? "Schedule not found."} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={schedule.name}
        subtitle={schedule.reportName}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {canRun && (
              <Button onClick={onRunNow} disabled={busy}>
                {busy ? "Working…" : "Run now"}
              </Button>
            )}
            {canUpdate && (
              <Link href={`/scheduled-reports/${schedule.id}/edit`}>
                <Button variant="secondary">Edit</Button>
              </Link>
            )}
          </div>
        }
      />

      <div className="mb-4">
        <Link
          href="/scheduled-reports"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Scheduled Reports
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={schedule.enabled ? "green" : "slate"}>
          {schedule.enabled ? "Enabled" : "Disabled"}
        </Badge>
        {schedule.lastRun && (
          <Badge tone={runStatusTone(schedule.lastRun.status)}>
            Last run: {schedule.lastRun.status}
          </Badge>
        )}
      </div>

      <ErrorNote message={actionError} />

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              Schedule details
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Detail label="Saved report" value={schedule.reportName} />
              <Detail
                label="Frequency"
                value={FREQUENCY_LABELS[schedule.frequency]}
              />
              <Detail label="Schedule" value={scheduleSummary(schedule)} />
              <Detail label="Timezone" value={schedule.timezone} />
              <Detail
                label="Export format"
                value={EXPORT_FORMAT_LABELS[schedule.exportFormat]}
              />
              <Detail
                label="Channels"
                value={
                  schedule.channels.length > 0
                    ? schedule.channels
                        .map((c) => CHANNEL_LABELS[c] ?? c)
                        .join(", ")
                    : null
                }
              />
              <Detail
                label="Recipients"
                value={`${schedule.recipients.length} user${
                  schedule.recipients.length === 1 ? "" : "s"
                }`}
              />
              <Detail
                label="Next run"
                value={formatDateTime(schedule.nextRunAt)}
              />
              <Detail
                label="Last run"
                value={formatDateTime(schedule.lastRunAt)}
              />
              <Detail
                label="Created"
                value={formatDateTime(schedule.createdAt)}
              />
            </div>
          </Card>

          {canHistory && (
            <Card>
              <h2 className="mb-4 text-lg font-semibold text-slate-900">
                Run history
              </h2>
              {runs.length === 0 ? (
                <EmptyState message="No runs recorded yet." />
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Trigger</th>
                        <th className="px-4 py-3">Started</th>
                        <th className="px-4 py-3">Completed</th>
                        <th className="px-4 py-3">Rows</th>
                        <th className="px-4 py-3">Recipients</th>
                        <th className="px-4 py-3">Delivery</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {runs.map((run) => (
                        <tr key={run.id} className="align-top">
                          <td className="px-4 py-3">
                            <Badge tone={runStatusTone(run.status)}>
                              {run.status}
                            </Badge>
                            {run.status === "failed" && run.errorMessage && (
                              <span className="mt-1 block text-xs text-red-600">
                                {run.errorMessage}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 capitalize text-slate-600">
                            {run.trigger}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                            {formatDateTime(run.startedAt)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                            {formatDateTime(run.completedAt)}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {run.rowCount ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {run.recipientCount ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {run.deliveryStatus ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              Actions
            </h2>
            <div className="space-y-3">
              {canRun && (
                <Button
                  className="w-full"
                  disabled={busy}
                  onClick={onRunNow}
                >
                  {busy ? "Working…" : "Run now"}
                </Button>
              )}
              {canUpdate && (
                <Button
                  className="w-full"
                  variant="secondary"
                  disabled={busy}
                  onClick={onToggleEnabled}
                >
                  {schedule.enabled ? "Disable" : "Enable"}
                </Button>
              )}
              {!canRun && !canUpdate && (
                <p className="text-sm text-slate-500">
                  You don't have permission to act on this schedule.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
