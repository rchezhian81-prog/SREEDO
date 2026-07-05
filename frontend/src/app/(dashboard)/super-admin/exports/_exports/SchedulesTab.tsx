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
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type { ExportFormat, ExportScope, ExportSchedule, ExportSchedulePage } from "@/types";
import { formatNumber } from "../../platform/_utils";
import {
  EXPORT_FORMATS,
  exportStatusTone,
  formatDateTime,
  formatLabel,
  humanizeToken,
  scopeLabel,
  scopeMeta,
  SCHEDULE_SCOPES,
} from "./taxonomy";
import { useInstitutions } from "./useInstitutions";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const FREQUENCIES: ExportSchedule["frequency"][] = ["daily", "weekly", "monthly"];

export function SchedulesTab({
  reloadKey,
  onChanged,
}: {
  reloadKey: number;
  onChanged: () => void;
}) {
  const [data, setData] = useState<ExportSchedulePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localReload, setLocalReload] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [toDelete, setToDelete] = useState<ExportSchedule | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<ExportSchedulePage>("/exports/schedules?pageSize=200"));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load export schedules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey, localReload]);

  const refreshAll = () => {
    setLocalReload((k) => k + 1);
    onChanged();
  };

  const toggle = async (s: ExportSchedule) => {
    setBusyId(s.id);
    try {
      await api.patch(`/exports/schedules/${s.id}`, { enabled: !s.enabled });
      toast.success(s.enabled ? "Schedule disabled." : "Schedule enabled.");
      refreshAll();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update schedule");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/exports/schedules/${toDelete.id}`);
      toast.success("Schedule deleted.");
      setToDelete(null);
      refreshAll();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete schedule");
    } finally {
      setDeleting(false);
    }
  };

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
        <div className="max-w-xl">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Scheduled exports</h2>
          <p className="mt-1 text-xs text-faint">
            Recurring exports run automatically with system attribution — each run is masked and fully
            audited. Ad-hoc sensitive exports (Exports tab) additionally require a reason and approval.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Icon name="plus" className="h-4 w-4" />
          New schedule
        </Button>
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No scheduled exports yet." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Scope</th>
                <th className="px-4 py-3">Format</th>
                <th className="px-4 py-3">Cadence</th>
                <th className="px-4 py-3">Next run</th>
                <th className="px-4 py-3">Last run</th>
                <th className="px-4 py-3">Enabled</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((s) => (
                <tr key={s.id} className="align-top hover:bg-hover">
                  <td className="px-4 py-3 font-medium text-ink">{s.name}</td>
                  <td className="px-4 py-3">
                    <span className="text-muted">{scopeLabel(s.scope)}</span>
                    {scopeMeta(s.scope)?.sensitive && (
                      <Badge tone="red">
                        <Icon name="shieldAlert" className="h-3 w-3" />
                        Sensitive
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">{formatLabel(s.format)}</td>
                  <td className="px-4 py-3 text-muted">
                    <span className="capitalize">{s.frequency}</span> · {s.runTime} UTC
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">
                    {s.enabled ? formatDateTime(s.nextRunAt) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {s.lastStatus ? (
                      <Badge tone={exportStatusTone(s.lastStatus)}>{humanizeToken(s.lastStatus)}</Badge>
                    ) : (
                      <span className="text-faint">Never run</span>
                    )}
                    {s.lastRunAt && (
                      <span className="mt-1 block text-xs text-faint">{formatDateTime(s.lastRunAt)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggle(s)}
                      disabled={busyId === s.id}
                      className={`inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-50 ${
                        s.enabled ? "bg-brand-600" : "bg-hover"
                      }`}
                      role="switch"
                      aria-checked={s.enabled}
                      aria-label={s.enabled ? "Disable schedule" : "Enable schedule"}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                          s.enabled ? "translate-x-5" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        className="!px-3 !py-1.5 !text-red-600"
                        onClick={() => setToDelete(s)}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && rows.length > 0 && (
        <p className="text-right text-xs text-faint">{formatNumber(data.total)} schedule(s)</p>
      )}

      <CreateScheduleModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          refreshAll();
        }}
      />

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete scheduled export?"
        confirmLabel="Delete schedule"
        busy={deleting}
        onConfirm={remove}
        onClose={() => setToDelete(null)}
        message={
          <div className="space-y-2">
            <p>
              Delete the schedule <strong>{toDelete?.name}</strong>? This removes the recurring
              configuration only — exports it has already produced are kept in the history.
            </p>
          </div>
        }
      />
    </div>
  );
}

function CreateScheduleModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const institutions = useInstitutions(open);

  const [name, setName] = useState("");
  const [scope, setScope] = useState<ExportScope>("institutions");
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [institutionId, setInstitutionId] = useState("");
  const [frequency, setFrequency] = useState<ExportSchedule["frequency"]>("daily");
  const [runTime, setRunTime] = useState("03:00");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setScope("institutions");
      setFormat("csv");
      setInstitutionId("");
      setFrequency("daily");
      setRunTime("03:00");
      setReason("");
      setBusy(false);
      setError(null);
    }
  }, [open]);

  const runTimeValid = TIME_RE.test(runTime);
  const nameValid = name.trim().length >= 3;
  const canSubmit = nameValid && runTimeValid && !busy;
  const sensitive = Boolean(scopeMeta(scope)?.sensitive);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/exports/schedules", {
        name: name.trim(),
        scope,
        format,
        ...(institutionId ? { institutionId } : {}),
        frequency,
        runTime,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      toast.success("Schedule created.");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create schedule");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New scheduled export" open={open} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <Field label="Schedule name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nightly institutions CSV" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Scope">
            <Select value={scope} onChange={(e) => setScope(e.target.value as ExportScope)}>
              {SCHEDULE_SCOPES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                  {s.sensitive ? " (sensitive)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Format">
            <Select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
              {EXPORT_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {formatLabel(f)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Frequency">
            <Select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as ExportSchedule["frequency"])}
            >
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Run time (HH:MM UTC)"
            error={runTime && !runTimeValid ? "Use 24-hour HH:MM." : undefined}
          >
            <Input value={runTime} onChange={(e) => setRunTime(e.target.value)} placeholder="03:00" />
          </Field>
        </div>
        <Field label="Tenant (optional)">
          <Select value={institutionId} onChange={(e) => setInstitutionId(e.target.value)}>
            <option value="">All tenants</option>
            {institutions.map((inst) => (
              <option key={inst.id} value={inst.id}>
                {inst.name} ({inst.code})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reason (optional)" hint="Recorded in the platform audit log.">
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this recurring export set up?"
          />
        </Field>

        {sensitive && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            This is a sensitive scope. Each scheduled run is masked and audited, and produces a
            sensitive export in the history (which expires under the shorter sensitive retention).
          </div>
        )}

        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {busy ? "Creating…" : "Create schedule"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
