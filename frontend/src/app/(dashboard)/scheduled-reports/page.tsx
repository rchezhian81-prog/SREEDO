"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { ScheduledReport, ScheduledReportRun } from "@/types";
import { formatDateTime, runStatusTone } from "./_utils";

const FREQUENCY_LABELS: Record<ScheduledReport["frequency"], string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

export default function ScheduledReportsPage() {
  const router = useRouter();
  const { can, loading: permsLoading } = usePermissions();
  const canRead = can("scheduled_reports:read");
  const canCreate = can("scheduled_reports:create");
  const canUpdate = can("scheduled_reports:update");
  const canDelete = can("scheduled_reports:delete");
  const canRun = can("scheduled_reports:run");

  const [schedules, setSchedules] = useState<ScheduledReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ScheduledReport | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setSchedules(await api.get<ScheduledReport[]>("/scheduled-reports"));
    } catch (err) {
      setSchedules([]);
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load schedules"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!permsLoading && canRead) load();
    else if (!permsLoading) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permsLoading, canRead]);

  const onToggleEnabled = async (schedule: ScheduledReport) => {
    setActionError(null);
    setBusyId(schedule.id);
    try {
      await api.patch<ScheduledReport>(`/scheduled-reports/${schedule.id}`, {
        enabled: !schedule.enabled,
      });
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to update schedule"
      );
    } finally {
      setBusyId(null);
    }
  };

  const onRunNow = async (schedule: ScheduledReport) => {
    setActionError(null);
    setBusyId(schedule.id);
    try {
      const run = await api.post<ScheduledReportRun>(
        `/scheduled-reports/${schedule.id}/run`
      );
      await load();
      if (run.status === "failed") {
        setActionError(
          run.errorMessage
            ? `Run failed: ${run.errorMessage}`
            : "Run failed."
        );
      }
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to run schedule"
      );
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = (schedule: ScheduledReport) => {
    setDeleting(schedule);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setActionError(null);
    setBusyId(deleting.id);
    try {
      await api.delete(`/scheduled-reports/${deleting.id}`);
      setDeleting(null);
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to delete schedule"
      );
    } finally {
      setBusyId(null);
    }
  };

  if (permsLoading || loading) {
    return (
      <>
        <PageHeader
          title="Scheduled Reports"
          subtitle="Automate delivery of saved reports"
        />
        <Spinner />
      </>
    );
  }

  if (!canRead) {
    return (
      <>
        <PageHeader
          title="Scheduled Reports"
          subtitle="Automate delivery of saved reports"
        />
        <EmptyState message="You don't have access to scheduled reports." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Scheduled Reports"
        subtitle="Automate delivery of saved reports"
        action={
          canCreate ? (
            <Link href="/scheduled-reports/new">
              <Button>+ New schedule</Button>
            </Link>
          ) : undefined
        }
      />

      {loadError ? (
        <ErrorNote message={loadError} />
      ) : (
        <div className="space-y-4">
          <ErrorNote message={actionError} />
          {schedules.length === 0 ? (
            <EmptyState message="No scheduled reports yet. Create one to get started." />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Report</th>
                    <th className="px-4 py-3">Schedule</th>
                    <th className="px-4 py-3">Next run</th>
                    <th className="px-4 py-3">Enabled</th>
                    <th className="px-4 py-3">Last run</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {schedules.map((schedule) => (
                    <tr key={schedule.id} className="hover:bg-hover">
                      <td className="px-4 py-3 font-medium text-ink">
                        <Link
                          href={`/scheduled-reports/${schedule.id}`}
                          className="text-brand-600 hover:text-brand-700"
                        >
                          {schedule.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {schedule.reportName}
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {FREQUENCY_LABELS[schedule.frequency]} ·{" "}
                        {schedule.runTime}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">
                        {formatDateTime(schedule.nextRunAt)}
                      </td>
                      <td className="px-4 py-3">
                        {canUpdate ? (
                          <button
                            type="button"
                            role="switch"
                            aria-checked={schedule.enabled}
                            aria-label="Toggle schedule enabled"
                            disabled={busyId === schedule.id}
                            onClick={() => onToggleEnabled(schedule)}
                            className={
                              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 " +
                              (schedule.enabled
                                ? "bg-brand-600"
                                : "bg-slate-300 dark:bg-slate-600")
                            }
                          >
                            <span
                              className={
                                "inline-block h-5 w-5 transform rounded-full bg-surface shadow transition " +
                                (schedule.enabled
                                  ? "translate-x-5"
                                  : "translate-x-0.5")
                              }
                            />
                          </button>
                        ) : (
                          <Badge tone={schedule.enabled ? "green" : "slate"}>
                            {schedule.enabled ? "Enabled" : "Disabled"}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {schedule.lastRun ? (
                          <Badge tone={runStatusTone(schedule.lastRun.status)}>
                            {schedule.lastRun.status}
                          </Badge>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-3">
                          {canRun && (
                            <button
                              onClick={() => onRunNow(schedule)}
                              disabled={busyId === schedule.id}
                              className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
                            >
                              Run now
                            </button>
                          )}
                          <Link
                            href={`/scheduled-reports/${schedule.id}`}
                            className="text-xs font-medium text-brand-600 hover:text-brand-700"
                          >
                            History
                          </Link>
                          {canUpdate && (
                            <button
                              onClick={() =>
                                router.push(
                                  `/scheduled-reports/${schedule.id}/edit`
                                )
                              }
                              className="text-xs font-medium text-brand-600 hover:text-brand-700"
                            >
                              Edit
                            </button>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => onDelete(schedule)}
                              disabled={busyId === schedule.id}
                              className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete schedule"
        message={deleting ? `Delete schedule "${deleting.name}"?` : ""}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        tone="danger"
        busy={deleting !== null && busyId === deleting.id}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
