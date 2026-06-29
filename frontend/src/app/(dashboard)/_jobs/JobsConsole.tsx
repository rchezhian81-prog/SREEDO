"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Input,
  Modal,
  Select,
  Spinner,
} from "@/components/ui";
import type {
  BackgroundJob,
  JobProcessResult,
  JobSchedulerResult,
  JobStatus,
  PlatformInstitution,
} from "@/types";

const STATUS_OPTIONS: JobStatus[] = [
  "pending",
  "running",
  "success",
  "failed",
  "cancelled",
];

const STATUS_TONES: Record<
  JobStatus,
  "slate" | "green" | "amber" | "red" | "blue"
> = {
  pending: "amber",
  running: "blue",
  success: "green",
  failed: "red",
  cancelled: "slate",
};

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatPayload(payload: Record<string, unknown> | null): string {
  if (payload == null) return "—";
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

export function JobsConsole() {
  const { can, role } = usePermissions();
  const isSuper = role === "super_admin";
  const canRetry = can("jobs:retry");
  const canCancel = can("jobs:cancel");
  const canRunScheduler = can("jobs:run_scheduler");
  const canManage = can("jobs:manage");

  // Filters.
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [institutionId, setInstitutionId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [institutions, setInstitutions] = useState<PlatformInstitution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Detail + actions.
  const [selected, setSelected] = useState<BackgroundJob | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [headerBusy, setHeaderBusy] = useState(false);

  // Super admins can scope the list to a single institution.
  useEffect(() => {
    if (!isSuper) return;
    api
      .get<{ rows: PlatformInstitution[] }>("/platform/institutions?pageSize=100&sort=name&order=asc")
      .then((d) => setInstitutions(d.rows))
      .catch(() => undefined);
  }, [isSuper]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (type.trim()) params.set("type", type.trim());
    if (isSuper && institutionId) params.set("institutionId", institutionId);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    params.set("limit", "200");
    return `?${params.toString()}`;
  }, [status, type, isSuper, institutionId, dateFrom, dateTo]);

  const load = useCallback(async (qs: string) => {
    setLoading(true);
    setError(null);
    try {
      setJobs(await api.get<BackgroundJob[]>(`/jobs${qs}`));
    } catch (err) {
      setJobs([]);
      setError(err instanceof ApiError ? err.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-fetch whenever the filters change.
  useEffect(() => {
    load(queryString);
  }, [load, queryString]);

  const refresh = useCallback(() => load(queryString), [load, queryString]);

  const onRetry = async (job: BackgroundJob) => {
    setActionError(null);
    setNotice(null);
    setBusyId(job.id);
    try {
      await api.post<BackgroundJob>(`/jobs/${job.id}/retry`);
      setSelected(null);
      await refresh();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to retry job"
      );
    } finally {
      setBusyId(null);
    }
  };

  const onCancel = async (job: BackgroundJob) => {
    setActionError(null);
    setNotice(null);
    setBusyId(job.id);
    try {
      await api.post<BackgroundJob>(`/jobs/${job.id}/cancel`);
      setSelected(null);
      await refresh();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to cancel job"
      );
    } finally {
      setBusyId(null);
    }
  };

  const onRunScheduler = async () => {
    setActionError(null);
    setNotice(null);
    setHeaderBusy(true);
    try {
      const result = await api.post<JobSchedulerResult>("/jobs/run-scheduler");
      setNotice(
        `Scheduler tick: ${result.due} due, ${result.enqueued} enqueued.`
      );
      await refresh();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to run scheduler"
      );
    } finally {
      setHeaderBusy(false);
    }
  };

  const onProcess = async () => {
    setActionError(null);
    setNotice(null);
    setHeaderBusy(true);
    try {
      const result = await api.post<JobProcessResult>("/jobs/process");
      setNotice(
        `Processed ${result.processed}: ${result.success} succeeded, ` +
          `${result.failed} failed, ${result.retried} retried.`
      );
      await refresh();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to process queue"
      );
    } finally {
      setHeaderBusy(false);
    }
  };

  return (
    <>
      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Status
            </span>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-48">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Type
            </span>
            <Input
              placeholder="e.g. scheduled_report"
              value={type}
              onChange={(e) => setType(e.target.value)}
            />
          </div>
          {isSuper && (
            <div className="w-60">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Institution
              </span>
              <Select
                value={institutionId}
                onChange={(e) => setInstitutionId(e.target.value)}
              >
                <option value="">All institutions</option>
                {institutions.map((inst) => (
                  <option key={inst.id} value={inst.id}>
                    {inst.name} ({inst.code})
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="w-40">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              From
            </span>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="w-40">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              To
            </span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <Button
            variant="secondary"
            onClick={refresh}
            disabled={loading || headerBusy}
          >
            {loading ? "Loading…" : "Refresh"}
          </Button>
          {canRunScheduler && (
            <Button onClick={onRunScheduler} disabled={headerBusy}>
              {headerBusy ? "Working…" : "Run scheduler tick"}
            </Button>
          )}
          {canManage && (
            <Button onClick={onProcess} disabled={headerBusy}>
              {headerBusy ? "Working…" : "Process queue now"}
            </Button>
          )}
        </div>
      </Card>

      {notice && (
        <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </p>
      )}
      <ErrorNote message={actionError} />
      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : jobs.length === 0 ? (
        !error ? (
          <EmptyState message="No jobs match these filters." />
        ) : null
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Attempts</th>
                  <th className="px-4 py-3">Run at</th>
                  <th className="px-4 py-3">Created</th>
                  {isSuper && <th className="px-4 py-3">Institution</th>}
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    className="cursor-pointer align-top hover:bg-slate-50"
                    onClick={() => {
                      setActionError(null);
                      setSelected(job);
                    }}
                  >
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {job.type}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONES[job.status]}>
                        {job.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {job.attempts}/{job.maxAttempts}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {formatDateTime(job.runAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {formatDateTime(job.createdAt)}
                    </td>
                    {isSuper && (
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">
                        {job.institutionId ?? "—"}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs font-medium text-brand-600 hover:text-brand-700">
                        View
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-slate-500">
            {jobs.length} {jobs.length === 1 ? "job" : "jobs"}
          </p>
        </>
      )}

      <Modal
        title={selected ? `Job · ${selected.type}` : "Job"}
        open={selected !== null}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONES[selected.status]}>
                {selected.status}
              </Badge>
              <span className="text-slate-500">
                Priority {selected.priority} · Attempt {selected.attempts}/
                {selected.maxAttempts}
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <dt className="text-slate-500">Job ID</dt>
              <dd className="break-all font-mono text-xs text-slate-700">
                {selected.id}
              </dd>
              <dt className="text-slate-500">Dedupe key</dt>
              <dd className="break-all font-mono text-xs text-slate-700">
                {selected.dedupeKey ?? "—"}
              </dd>
              <dt className="text-slate-500">Institution</dt>
              <dd className="break-all font-mono text-xs text-slate-700">
                {selected.institutionId ?? "—"}
              </dd>
              <dt className="text-slate-500">Created by</dt>
              <dd className="break-all font-mono text-xs text-slate-700">
                {selected.createdBy ?? "—"}
              </dd>
              <dt className="text-slate-500">Run at</dt>
              <dd className="text-slate-700">{formatDateTime(selected.runAt)}</dd>
              <dt className="text-slate-500">Started</dt>
              <dd className="text-slate-700">
                {formatDateTime(selected.startedAt)}
              </dd>
              <dt className="text-slate-500">Completed</dt>
              <dd className="text-slate-700">
                {formatDateTime(selected.completedAt)}
              </dd>
              <dt className="text-slate-500">Locked at</dt>
              <dd className="text-slate-700">
                {formatDateTime(selected.lockedAt)}
              </dd>
              <dt className="text-slate-500">Locked by</dt>
              <dd className="break-all font-mono text-xs text-slate-700">
                {selected.lockedBy ?? "—"}
              </dd>
              <dt className="text-slate-500">Created</dt>
              <dd className="text-slate-700">
                {formatDateTime(selected.createdAt)}
              </dd>
              <dt className="text-slate-500">Updated</dt>
              <dd className="text-slate-700">
                {formatDateTime(selected.updatedAt)}
              </dd>
            </dl>

            <div>
              <p className="mb-1 font-medium text-slate-700">Payload</p>
              <pre className="max-h-60 overflow-auto rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-700">
                {formatPayload(selected.payload)}
              </pre>
            </div>

            {selected.error && (
              <div>
                <p className="mb-1 font-medium text-slate-700">Error</p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-red-50 p-3 font-mono text-xs text-red-700">
                  {selected.error}
                </pre>
              </div>
            )}

            <ErrorNote message={actionError} />

            {(canRetry && selected.status === "failed") ||
            (canCancel && selected.status === "pending") ? (
              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
                {canRetry && selected.status === "failed" && (
                  <Button
                    onClick={() => onRetry(selected)}
                    disabled={busyId === selected.id}
                  >
                    {busyId === selected.id ? "Retrying…" : "Retry"}
                  </Button>
                )}
                {canCancel && selected.status === "pending" && (
                  <Button
                    variant="danger"
                    onClick={() => onCancel(selected)}
                    disabled={busyId === selected.id}
                  >
                    {busyId === selected.id ? "Cancelling…" : "Cancel"}
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        )}
      </Modal>
    </>
  );
}
