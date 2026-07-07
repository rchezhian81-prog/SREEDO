"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, ErrorNote, Field, Modal, Spinner, Textarea } from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type { JobDetail } from "@/types";
import { compactDetail, formatNumber } from "../../platform/_utils";
import { RefChip } from "./OverviewTab";
import {
  attemptStatusTone,
  durationBetween,
  formatDateTime,
  formatDuration,
  formatMs,
  humanizeToken,
  jobStatusLabel,
  jobStatusTone,
  shortId,
} from "./taxonomy";

type View = "menu" | "retry" | "cancel" | "deadletter" | "requeue";

const MIN_REASON = 5;

export function JobDetailModal({
  id,
  onClose,
  onChanged,
}: {
  id: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>("menu");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setJob(await api.get<JobDetail>(`/jobs-ops/jobs/${id}`));
    } catch (err) {
      setJob(null);
      setError(err instanceof ApiError ? err.message : "Failed to load job");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) {
      setView("menu");
      setReason("");
      setBusy(false);
      setError(null);
      reload();
    }
  }, [id, reload]);

  if (!id) return null;

  const run = async (
    path: string,
    body: Record<string, unknown>,
    ok: string
  ) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.post<JobDetail>(path, body);
      setJob(updated);
      toast.success(ok);
      onChanged();
      setView("menu");
      setReason("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const doRetry = () =>
    run(`/jobs-ops/jobs/${id}/retry`, reason.trim() ? { reason: reason.trim() } : {}, "Job re-queued for retry.");
  const doCancel = () =>
    run(`/jobs-ops/jobs/${id}/cancel`, reason.trim() ? { reason: reason.trim() } : {}, "Job cancelled.");
  const doDeadLetter = () =>
    run(`/jobs-ops/jobs/${id}/dead-letter`, { reason: reason.trim() }, "Job moved to the dead-letter queue.");
  const doRequeue = () =>
    run(`/jobs-ops/jobs/${id}/requeue`, { reason: reason.trim() }, "Job requeued from dead-letter.");

  const openView = (v: View) => {
    setReason("");
    setError(null);
    setView(v);
  };

  const canRetry = job?.status === "failed" || job?.status === "dead_letter";
  const canCancel = job?.status === "pending";
  const canDeadLetter = job?.status === "failed";
  const canRequeue = job?.status === "dead_letter";

  const title =
    view === "retry"
      ? "Retry job"
      : view === "cancel"
        ? "Cancel job"
        : view === "deadletter"
          ? "Move to dead-letter"
          : view === "requeue"
            ? "Requeue job"
            : job
              ? humanizeToken(job.type)
              : "Job";

  const reasonRequired = view === "deadletter" || view === "requeue";
  const reasonOk = !reasonRequired || reason.trim().length >= MIN_REASON;

  return (
    <Modal title={title} open={id !== null} onClose={onClose}>
      {loading ? (
        <Spinner />
      ) : !job ? (
        <ErrorNote message={error ?? "Job not found."} />
      ) : view !== "menu" ? (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={jobStatusTone(job.status)}>{jobStatusLabel(job.status)}</Badge>
            <span className="font-mono text-xs text-faint">{shortId(job.id)}</span>
          </div>
          {reasonRequired ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              This action is audited. A reason of at least 5 characters is required and recorded in the
              platform audit log.
            </div>
          ) : null}
          <Field
            label={reasonRequired ? "Reason (min 5 characters)" : "Reason (optional)"}
            error={
              reasonRequired && reason.length > 0 && reason.trim().length < MIN_REASON
                ? "At least 5 characters required."
                : undefined
            }
          >
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this action being taken?"
            />
          </Field>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setView("menu")} disabled={busy}>
              Back
            </Button>
            <Button
              variant={view === "deadletter" || view === "cancel" ? "danger" : "primary"}
              onClick={
                view === "retry"
                  ? doRetry
                  : view === "cancel"
                    ? doCancel
                    : view === "deadletter"
                      ? doDeadLetter
                      : doRequeue
              }
              disabled={busy || !reasonOk}
            >
              {busy
                ? "Working…"
                : view === "retry"
                  ? "Retry job"
                  : view === "cancel"
                    ? "Cancel job"
                    : view === "deadletter"
                      ? "Move to dead-letter"
                      : "Requeue job"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5 text-sm">
          {/* Status header */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={jobStatusTone(job.status)}>{jobStatusLabel(job.status)}</Badge>
            {job.stuck && <Badge tone="amber">Stuck</Badge>}
            <Badge tone="slate">{job.sourceModule}</Badge>
            <span className="text-muted">{humanizeToken(job.type)}</span>
          </div>

          {/* Core fields */}
          <dl className="grid gap-2 sm:grid-cols-2">
            <Row label="Job ID" value={<span className="font-mono text-xs">{job.id}</span>} />
            <Row label="Queue" value={job.queue} />
            <Row label="Priority" value={formatNumber(job.priority)} />
            <Row label="Attempts logged" value={`${formatNumber(job.attempts.length)} / ${formatNumber(job.maxAttempts)} max`} />
            <Row
              label="Tenant"
              value={
                job.institutionName
                  ? `${job.institutionName}${job.institutionCode ? ` (${job.institutionCode})` : ""}`
                  : "Platform"
              }
            />
            <Row label="Worker" value={job.lockedBy ? <span className="font-mono text-xs">{job.lockedBy}</span> : "—"} />
            <Row label="Created" value={formatDateTime(job.createdAt)} />
            <Row label="Run at / next" value={formatDateTime(job.runAt)} />
            <Row label="Started" value={formatDateTime(job.startedAt)} />
            <Row label="Completed" value={formatDateTime(job.completedAt)} />
            <Row label="Duration" value={durationBetween(job.startedAt, job.completedAt)} />
            <Row label="Updated" value={formatDateTime(job.updatedAt)} />
            {job.deadLetteredAt && <Row label="Dead-lettered" value={formatDateTime(job.deadLetteredAt)} />}
          </dl>

          {job.deadLetterReason && (
            <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
              <span className="font-semibold">Dead-letter reason:</span> {job.deadLetterReason}
            </div>
          )}
          {job.error && (
            <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
              <span className="font-semibold text-ink">Error (masked):</span> {job.error}
            </div>
          )}

          {/* Related links */}
          {job.relatedLinks.length > 0 && (
            <div>
              <SubHeading>Related entities</SubHeading>
              <div className="flex flex-wrap gap-2">
                {job.relatedLinks.map((l) => (
                  <RefChip key={`${l.key}-${l.id}`} label={l.type} id={l.id} />
                ))}
              </div>
            </div>
          )}

          {/* Masked payload */}
          <div>
            <SubHeading>Payload (masked)</SubHeading>
            <JsonViewer value={job.payload} />
          </div>

          {/* Retry policy */}
          <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
            Retry policy: max {formatNumber(job.retryPolicy.maxAttempts)} attempts ·{" "}
            {job.retryPolicy.backoffStrategy} backoff (base {formatMs(job.retryPolicy.backoffBaseMs)})
          </div>

          {/* Actions */}
          <div className="flex flex-wrap justify-end gap-2">
            {canRetry && (
              <Button variant="secondary" onClick={() => openView("retry")} disabled={busy}>
                <Icon name="history" className="h-4 w-4" />
                Retry
              </Button>
            )}
            {canCancel && (
              <Button variant="secondary" onClick={() => openView("cancel")} disabled={busy}>
                Cancel
              </Button>
            )}
            {canRequeue && (
              <Button variant="secondary" onClick={() => openView("requeue")} disabled={busy}>
                Requeue
              </Button>
            )}
            {canDeadLetter && (
              <Button variant="danger" onClick={() => openView("deadletter")} disabled={busy}>
                Dead-letter
              </Button>
            )}
          </div>

          {/* Attempt timeline */}
          <div>
            <SubHeading>Attempt timeline</SubHeading>
            {job.attempts.length === 0 ? (
              <p className="text-muted">No attempts logged yet.</p>
            ) : (
              <ul className="space-y-2">
                {job.attempts.map((a) => (
                  <li key={a.id} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge tone={attemptStatusTone(a.status)}>#{a.attemptNumber} {humanizeToken(a.status)}</Badge>
                        {a.workerId && <span className="font-mono text-xs text-faint">{a.workerId}</span>}
                      </div>
                      <span className="text-xs text-faint">
                        {a.durationMs != null ? formatDuration(a.durationMs) : "—"}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
                      <span>Started {formatDateTime(a.startedAt)}</span>
                      <span>Finished {formatDateTime(a.finishedAt)}</span>
                      {a.backoffMs != null && <span>Backoff {formatMs(a.backoffMs)}</span>}
                      {a.nextRetryAt && <span>Next retry {formatDateTime(a.nextRetryAt)}</span>}
                    </div>
                    {a.retryReason && (
                      <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                        Retry reason: {humanizeToken(a.retryReason)}
                      </p>
                    )}
                    {a.error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">Error: {a.error}</p>}
                    {a.resultSummary && <p className="mt-1 text-xs text-muted">Result: {a.resultSummary}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Recent audit */}
          <div>
            <SubHeading>Recent audit</SubHeading>
            {job.recentAudit.length === 0 ? (
              <p className="text-muted">No audit events for this job.</p>
            ) : (
              <ul className="max-h-56 divide-y divide-line overflow-auto rounded-lg border border-line">
                {job.recentAudit.map((e) => (
                  <li key={e.id} className="px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-ink">{humanizeToken(e.action)}</span>
                      <span className="text-faint">{formatDateTime(e.createdAt)}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-muted">
                      {e.actorEmail && <span>{e.actorEmail}</span>}
                      {e.detail && Object.keys(e.detail).length > 0 && (
                        <span className="truncate text-faint" title={compactDetail(e.detail)}>
                          {compactDetail(e.detail)}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function JsonViewer({ value }: { value: Record<string, unknown> }) {
  const empty = !value || Object.keys(value).length === 0;
  if (empty) {
    return <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-faint">No payload.</p>;
  }
  return (
    <pre className="max-h-72 overflow-auto rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{children}</p>;
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 font-medium text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{value}</dd>
    </div>
  );
}
