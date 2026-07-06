"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  Field,
  Modal,
  Spinner,
  Textarea,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type {
  JobProcessResult,
  JobSchedule,
  JobSchedulerRunResult,
  JobSchedulesResult,
} from "@/types";
import { formatNumber } from "../../platform/_utils";
import {
  formatDateTime,
  humanizeToken,
  runStatusTone,
  scheduleStatusTone,
  titleCase,
} from "./taxonomy";

const MIN_REASON = 5;

type SchedAction = "pause" | "resume" | "run_now";
type SchedPending = { schedule: JobSchedule; action: SchedAction } | null;
type RunOp = "process" | "scheduler" | null;

export function SchedulerTab({ reloadKey }: { reloadKey: number }) {
  const [data, setData] = useState<JobSchedulesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localReload, setLocalReload] = useState(0);

  const [pending, setPending] = useState<SchedPending>(null);
  const [runOp, setRunOp] = useState<RunOp>(null);
  const [runBusy, setRunBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<JobSchedulesResult>("/jobs-ops/schedules"));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load schedules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey, localReload]);

  const refresh = () => setLocalReload((k) => k + 1);

  const schedules = data?.schedules ?? [];

  const runNowOps = async () => {
    if (!runOp) return;
    setRunBusy(true);
    try {
      if (runOp === "process") {
        const r = await api.post<JobProcessResult>("/jobs-ops/process");
        toast.success(
          `Processed ${r.processed} — ${r.success} ok · ${r.failed} failed · ${r.retried} retried.`
        );
      } else {
        const r = await api.post<JobSchedulerRunResult>("/jobs-ops/run-scheduler");
        toast.success(`Scheduler tick — ${r.reports} reports · ${r.backups} backups · ${r.exports} exports enqueued.`);
      }
      setRunOp(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Operation failed");
    } finally {
      setRunBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Recurring schedules</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setRunOp("scheduler")}>
            <Icon name="calendarClock" className="h-4 w-4" />
            Run scheduler tick
          </Button>
          <Button variant="secondary" onClick={() => setRunOp("process")}>
            <Icon name="rocket" className="h-4 w-4" />
            Process queue now
          </Button>
        </div>
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : schedules.length === 0 ? (
        <EmptyState message="No recurring schedules found." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Schedule</th>
                <th className="px-4 py-3">Frequency</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last run</th>
                <th className="px-4 py-3">Next run</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {schedules.map((s) => (
                <tr key={`${s.source}-${s.id}`} className="hover:bg-hover">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink">{s.name}</span>
                      {s.critical && <Badge tone="amber">Critical</Badge>}
                    </div>
                    <span className="block text-xs text-faint">
                      {titleCase(s.source)} · {humanizeToken(s.jobType)}
                      {s.institutionName ? ` · ${s.institutionName}` : ""}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted">{s.frequency ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={scheduleStatusTone(s.status)}>{titleCase(s.status)}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-faint">
                    <span className="block text-muted">{formatDateTime(s.lastRunAt)}</span>
                    {s.lastStatus && (
                      <Badge tone={runStatusTone(s.lastStatus)}>{titleCase(s.lastStatus)}</Badge>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-faint">{formatDateTime(s.nextRunAt)}</td>
                  <td className="px-4 py-3">
                    <ScheduleActions schedule={s} onAct={setPending} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ScheduleActionDialog
        pending={pending}
        onClose={() => setPending(null)}
        onDone={() => {
          setPending(null);
          refresh();
        }}
      />

      <ConfirmDialog
        open={runOp !== null}
        title={runOp === "process" ? "Process the queue now" : "Run the scheduler tick"}
        tone="primary"
        confirmLabel={runOp === "process" ? "Process now" : "Run tick"}
        busy={runBusy}
        message={
          runOp === "process"
            ? "This drains due jobs immediately using an on-demand worker run. The action is audited."
            : "This enqueues any due scheduled reports, backups and exports immediately. The action is audited."
        }
        onConfirm={runNowOps}
        onClose={() => (runBusy ? undefined : setRunOp(null))}
      />
    </section>
  );
}

function ScheduleActions({
  schedule,
  onAct,
}: {
  schedule: JobSchedule;
  onAct: (p: SchedPending) => void;
}) {
  const isSystem = schedule.source === "system";
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {isSystem ? (
        <span
          title="System schedules run on every worker tick and cannot be paused or resumed."
          className="inline-flex"
        >
          <Button variant="secondary" className="!px-2.5 !py-1.5" disabled>
            Pause
          </Button>
        </span>
      ) : schedule.enabled ? (
        <Button
          variant="secondary"
          className="!px-2.5 !py-1.5"
          onClick={() => onAct({ schedule, action: "pause" })}
        >
          Pause
        </Button>
      ) : (
        <Button
          variant="secondary"
          className="!px-2.5 !py-1.5"
          onClick={() => onAct({ schedule, action: "resume" })}
        >
          Resume
        </Button>
      )}
      <Button
        variant="secondary"
        className="!px-2.5 !py-1.5"
        onClick={() => onAct({ schedule, action: "run_now" })}
      >
        Run now
      </Button>
    </div>
  );
}

function ScheduleActionDialog({
  pending,
  onClose,
  onDone,
}: {
  pending: SchedPending;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pending) {
      setReason("");
      setBusy(false);
      setError(null);
    }
  }, [pending]);

  if (!pending) return null;
  const { schedule, action } = pending;

  // The backend requires a reason for pausing OR running the critical (backup)
  // schedule now. Everything else is optional.
  const reasonRequired = schedule.critical && (action === "pause" || action === "run_now");
  const reasonOk = !reasonRequired || reason.trim().length >= MIN_REASON;

  const title =
    action === "pause" ? "Pause schedule" : action === "resume" ? "Resume schedule" : "Run schedule now";

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(
        `/jobs-ops/schedules/${encodeURIComponent(schedule.source)}/${encodeURIComponent(schedule.id)}/action`,
        reason.trim() ? { action, reason: reason.trim() } : { action }
      );
      toast.success(
        action === "pause"
          ? "Schedule paused."
          : action === "resume"
            ? "Schedule resumed."
            : "Schedule run enqueued."
      );
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
      setBusy(false);
    }
  };

  return (
    <Modal title={title} open={pending !== null} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          <span className="font-semibold text-ink">{schedule.name}</span>
          {schedule.critical && " — this is a critical schedule."}
        </p>
        {reasonRequired && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            This action is audited. A reason of at least 5 characters is required.
          </div>
        )}
        <Field
          label={reasonRequired ? "Reason (min 5 characters)" : "Reason (optional)"}
          error={reasonRequired && reason.length > 0 && reason.trim().length < MIN_REASON ? "At least 5 characters required." : undefined}
        >
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this action being taken?" />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !reasonOk}>
            {busy ? "Working…" : title}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
