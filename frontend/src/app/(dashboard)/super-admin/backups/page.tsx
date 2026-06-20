"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { Backup, BackupRestorePreview, BackupSettings } from "@/types";
import { useAuthStore } from "@/stores/auth-store";
import { usePlatformGuard } from "../platform/_guard";
import { formatBytes, formatNumber } from "../platform/_utils";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

/** Binary download can't go through api.ts (it returns JSON) — fetch the blob
 * directly, reusing the same access token the API client uses. */
async function downloadBackup(id: string) {
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${API_URL}/backups/${id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Download failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backup-${id}.json.gz`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function statusTone(status: Backup["status"]): "green" | "red" | "slate" {
  if (status === "success") return "green";
  if (status === "failed") return "red";
  return "slate";
}

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </h2>
  );
}

export default function BackupsPage() {
  const { ready, gate } = usePlatformGuard(
    "Backups",
    "Database backup & restore"
  );

  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create-backup (manual trigger) state.
  const [creating, setCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  // Settings state.
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [retentionInput, setRetentionInput] = useState("");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleFrequency, setScheduleFrequency] =
    useState<BackupSettings["scheduleFrequency"]>("daily");
  const [scheduleRunTime, setScheduleRunTime] = useState("02:00");
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // Per-row action busy state, keyed by `${action}:${id}`.
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  // Inline delete confirm — id of the backup awaiting confirmation.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Restore modal state.
  const [restoreTarget, setRestoreTarget] = useState<Backup | null>(null);
  const [preview, setPreview] = useState<BackupRestorePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [restoreAck, setRestoreAck] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreDone, setRestoreDone] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, cfg] = await Promise.all([
        api.get<Backup[]>("/backups"),
        api.get<BackupSettings>("/backups/settings").catch(() => null),
      ]);
      setBackups(list);
      if (cfg) {
        setSettings(cfg);
        setRetentionInput(
          cfg.retentionCount == null ? "" : String(cfg.retentionCount)
        );
        setScheduleEnabled(cfg.scheduleEnabled);
        setScheduleFrequency(cfg.scheduleFrequency);
        setScheduleRunTime(cfg.scheduleRunTime);
      }
    } catch (err) {
      setBackups([]);
      setError(
        err instanceof ApiError ? err.message : "Failed to load backups"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  async function createBackup() {
    if (creating) return;
    setCreating(true);
    setCreateMessage(null);
    setCreateError(null);
    try {
      await api.post<Backup>("/backups", { scope: "global" });
      setCreateMessage("Backup started — it will appear in the list below.");
      await load();
    } catch (err) {
      setCreateError(
        err instanceof ApiError ? err.message : "Failed to start backup"
      );
    } finally {
      setCreating(false);
    }
  }

  async function saveSettings() {
    if (savingSettings) return;
    setSavingSettings(true);
    setSettingsMessage(null);
    setSettingsError(null);
    const trimmed = retentionInput.trim();
    const retentionCount = trimmed === "" ? null : Number(trimmed);
    if (retentionCount != null && (!Number.isFinite(retentionCount) || retentionCount < 1)) {
      setSettingsError("Retention must be a whole number of 1 or more (or empty to disable).");
      setSavingSettings(false);
      return;
    }
    try {
      const updated = await api.patch<BackupSettings>("/backups/settings", {
        retentionCount,
        scheduleEnabled,
        scheduleFrequency,
        scheduleRunTime,
      });
      setSettings(updated);
      setRetentionInput(
        updated.retentionCount == null ? "" : String(updated.retentionCount)
      );
      setScheduleEnabled(updated.scheduleEnabled);
      setScheduleFrequency(updated.scheduleFrequency);
      setScheduleRunTime(updated.scheduleRunTime);
      setSettingsMessage("Settings saved.");
    } catch (err) {
      setSettingsError(
        err instanceof ApiError ? err.message : "Failed to save settings"
      );
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleDownload(id: string) {
    const key = `download:${id}`;
    if (rowBusy) return;
    setRowBusy(key);
    setRowError(null);
    try {
      await downloadBackup(id);
    } catch {
      setRowError("Download failed.");
    } finally {
      setRowBusy(null);
    }
  }

  async function handleDelete(id: string) {
    const key = `delete:${id}`;
    if (rowBusy) return;
    setRowBusy(key);
    setRowError(null);
    try {
      await api.delete(`/backups/${id}`);
      setConfirmDeleteId(null);
      await load();
    } catch (err) {
      setRowError(
        err instanceof ApiError ? err.message : "Failed to delete backup"
      );
    } finally {
      setRowBusy(null);
    }
  }

  function openRestore(backup: Backup) {
    setRestoreTarget(backup);
    setPreview(null);
    setPreviewError(null);
    setRestoreAck(false);
    setRestoreError(null);
    setRestoreDone(false);
    setPreviewLoading(true);
    api
      .get<BackupRestorePreview>(`/backups/${backup.id}/restore/preview`)
      .then((p) => setPreview(p))
      .catch((err) =>
        setPreviewError(
          err instanceof ApiError ? err.message : "Failed to load preview"
        )
      )
      .finally(() => setPreviewLoading(false));
  }

  function closeRestore() {
    if (restoring) return;
    setRestoreTarget(null);
    setPreview(null);
    setPreviewError(null);
    setRestoreAck(false);
    setRestoreError(null);
    setRestoreDone(false);
  }

  async function confirmRestore() {
    if (!restoreTarget || restoring) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      await api.post(`/backups/${restoreTarget.id}/restore`, { confirm: true });
      setRestoreDone(true);
      await load();
    } catch (err) {
      setRestoreError(
        err instanceof ApiError ? err.message : "Restore failed"
      );
    } finally {
      setRestoring(false);
    }
  }

  if (!ready) return gate;

  return (
    <>
      <PageHeader
        title="Backups"
        subtitle="Database backup & restore"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={load} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
            <Button onClick={createBackup} disabled={creating}>
              {creating ? "Creating…" : "Create backup"}
            </Button>
          </div>
        }
      />

      {createMessage && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {createMessage}
        </p>
      )}
      {createError && <ErrorNote message={createError} />}

      <div className="space-y-8">
        {/* Retention & schedule settings */}
        <div>
          <SectionHeading>Retention &amp; schedule</SectionHeading>
          <Card>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Keep latest N backups">
                <Input
                  type="number"
                  min={1}
                  step={1}
                  placeholder="Off (keep all)"
                  value={retentionInput}
                  onChange={(e) => setRetentionInput(e.target.value)}
                />
              </Field>
              <Field label="Frequency">
                <Select
                  value={scheduleFrequency}
                  onChange={(e) =>
                    setScheduleFrequency(
                      e.target.value as BackupSettings["scheduleFrequency"]
                    )
                  }
                  disabled={!scheduleEnabled}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </Select>
              </Field>
              <Field label="Run time (HH:MM)">
                <Input
                  type="text"
                  placeholder="02:00"
                  value={scheduleRunTime}
                  onChange={(e) => setScheduleRunTime(e.target.value)}
                  disabled={!scheduleEnabled}
                />
              </Field>
              <label className="flex items-end gap-2 pb-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
                  checked={scheduleEnabled}
                  onChange={(e) => setScheduleEnabled(e.target.checked)}
                />
                <span className="text-sm font-medium text-slate-700">
                  Automatic scheduled backups
                </span>
              </label>
            </div>

            {scheduleEnabled && (
              <p className="mt-3 text-xs text-slate-500">
                Next scheduled run:{" "}
                <span className="font-medium text-slate-700">
                  {formatTimestamp(settings?.nextRunAt ?? null)}
                </span>
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={saveSettings} disabled={savingSettings}>
                {savingSettings ? "Saving…" : "Save settings"}
              </Button>
              {settingsMessage && (
                <span className="text-sm text-emerald-700">
                  {settingsMessage}
                </span>
              )}
            </div>
            {settingsError && (
              <div className="mt-2">
                <ErrorNote message={settingsError} />
              </div>
            )}
          </Card>
        </div>

        {/* Backups list */}
        <div>
          <SectionHeading>Backups</SectionHeading>
          {rowError && (
            <div className="mb-2">
              <ErrorNote message={rowError} />
            </div>
          )}
          {loading ? (
            <Spinner />
          ) : error ? (
            <ErrorNote message={error} />
          ) : backups.length === 0 ? (
            <EmptyState message="No backups yet." />
          ) : (
            <Card className="overflow-x-auto p-0">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Scope</th>
                    <th className="px-4 py-3 font-medium">Trigger</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Size</th>
                    <th className="px-4 py-3 font-medium">Rows</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((backup) => {
                    const canRestore =
                      backup.scope === "global" &&
                      backup.status === "success";
                    const downloading = rowBusy === `download:${backup.id}`;
                    const deleting = rowBusy === `delete:${backup.id}`;
                    const confirming = confirmDeleteId === backup.id;
                    return (
                      <tr
                        key={backup.id}
                        className="border-b border-slate-100 last:border-0 align-top"
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                          {formatTimestamp(backup.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={backup.scope === "global" ? "blue" : "slate"}>
                            {backup.scope}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-600 capitalize">
                          {backup.trigger}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={statusTone(backup.status)}>
                            {backup.status}
                          </Badge>
                          {backup.status === "failed" && backup.error && (
                            <span
                              className="mt-1 block max-w-xs truncate text-xs text-red-600"
                              title={backup.error}
                            >
                              {backup.error}
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                          {backup.sizeBytes == null
                            ? "—"
                            : formatBytes(Number(backup.sizeBytes))}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                          {backup.rowCount == null
                            ? "—"
                            : formatNumber(backup.rowCount)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {backup.hasArtifact && (
                              <Button
                                variant="secondary"
                                onClick={() => handleDownload(backup.id)}
                                disabled={!!rowBusy}
                              >
                                {downloading ? "Downloading…" : "Download"}
                              </Button>
                            )}
                            {canRestore && (
                              <Button
                                variant="secondary"
                                onClick={() => openRestore(backup)}
                                disabled={!!rowBusy}
                              >
                                Restore
                              </Button>
                            )}
                            {confirming ? (
                              <span className="inline-flex items-center gap-2">
                                <Button
                                  variant="danger"
                                  onClick={() => handleDelete(backup.id)}
                                  disabled={!!rowBusy}
                                >
                                  {deleting ? "Deleting…" : "Confirm delete"}
                                </Button>
                                <Button
                                  variant="ghost"
                                  onClick={() => setConfirmDeleteId(null)}
                                  disabled={deleting}
                                >
                                  Cancel
                                </Button>
                              </span>
                            ) : (
                              <Button
                                variant="ghost"
                                onClick={() => {
                                  setRowError(null);
                                  setConfirmDeleteId(backup.id);
                                }}
                                disabled={!!rowBusy}
                              >
                                Delete
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      </div>

      {/* Restore confirmation modal (destructive, high-friction) */}
      <Modal
        title="Restore database from backup"
        open={restoreTarget !== null}
        onClose={closeRestore}
      >
        {restoreDone ? (
          <div className="space-y-4">
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              Restore completed successfully.
            </p>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={closeRestore}>
                Close
              </Button>
            </div>
          </div>
        ) : previewLoading ? (
          <Spinner />
        ) : previewError ? (
          <div className="space-y-4">
            <ErrorNote message={previewError} />
            <div className="flex justify-end">
              <Button variant="secondary" onClick={closeRestore}>
                Close
              </Button>
            </div>
          </div>
        ) : preview ? (
          <div className="space-y-4">
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              This overwrites the <strong>entire database</strong> with the
              contents of this backup. All current data not in the backup will be
              permanently lost. This cannot be undone.
            </p>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-slate-500">Scope</dt>
              <dd className="font-medium text-slate-900 capitalize">
                {preview.scope}
              </dd>
              <dt className="text-slate-500">Created</dt>
              <dd className="font-medium text-slate-900">
                {formatTimestamp(preview.createdAt)}
              </dd>
              <dt className="text-slate-500">Tables</dt>
              <dd className="font-medium text-slate-900">
                {formatNumber(preview.tableCount)}
              </dd>
              <dt className="text-slate-500">Total rows</dt>
              <dd className="font-medium text-slate-900">
                {formatNumber(preview.totalRows)}
              </dd>
              <dt className="text-slate-500">Schema</dt>
              <dd>
                <Badge tone={preview.schemaMatches ? "green" : "amber"}>
                  {preview.schemaMatches
                    ? "matches current"
                    : `v${preview.schemaVersion} → v${preview.currentSchemaVersion}`}
                </Badge>
              </dd>
            </dl>

            {!preview.restorable && (
              <ErrorNote message="This backup is not restorable (schema mismatch or missing artifact). Restore is disabled." />
            )}

            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-red-500/30"
                checked={restoreAck}
                onChange={(e) => setRestoreAck(e.target.checked)}
                disabled={!preview.restorable || restoring}
              />
              <span className="text-sm text-slate-700">
                I understand this overwrites the entire database.
              </span>
            </label>

            {restoreError && <ErrorNote message={restoreError} />}

            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={closeRestore}
                disabled={restoring}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={confirmRestore}
                disabled={!preview.restorable || !restoreAck || restoring}
              >
                {restoring ? "Restoring…" : "Restore database"}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
