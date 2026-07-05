"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorNote,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type { BackupSettings, EncryptionStatus, OffsiteStatus } from "@/types";
import { formatDateTime, syncStatusTone, titleCase } from "./taxonomy";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

interface FormState {
  scheduleEnabled: boolean;
  scheduleFrequency: BackupSettings["scheduleFrequency"];
  scheduleRunTime: string;
  retentionCount: string; // "" = keep all
  retentionMinKeep: string;
  offsiteEnabled: boolean;
  failureAlertEnabled: boolean;
  alertEmails: string;
}

function toForm(s: BackupSettings): FormState {
  return {
    scheduleEnabled: s.scheduleEnabled,
    scheduleFrequency: s.scheduleFrequency,
    scheduleRunTime: s.scheduleRunTime,
    retentionCount: s.retentionCount == null ? "" : String(s.retentionCount),
    retentionMinKeep: s.retentionMinKeep == null ? "" : String(s.retentionMinKeep),
    offsiteEnabled: s.offsiteEnabled,
    failureAlertEnabled: s.failureAlertEnabled,
    alertEmails: s.alertEmails ?? "",
  };
}

export function SettingsTab({
  reloadKey,
  onChanged,
}: {
  reloadKey: number;
  onChanged: () => void;
}) {
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [offsite, setOffsite] = useState<OffsiteStatus | null>(null);
  const [encryption, setEncryption] = useState<EncryptionStatus | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, o, e] = await Promise.all([
        api.get<BackupSettings>("/backups/settings"),
        api.get<OffsiteStatus>("/backups/offsite").catch(() => null),
        api.get<EncryptionStatus>("/backups/encryption").catch(() => null),
      ]);
      setSettings(s);
      setForm(toForm(s));
      setOffsite(o);
      setEncryption(e);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load backup settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  if (loading) return <Spinner />;
  if (error && !settings) return <ErrorNote message={error} />;
  if (!settings || !form) return null;

  const patch = (p: Partial<FormState>) => setForm((prev) => (prev ? { ...prev, ...p } : prev));

  const runTimeValid = TIME_RE.test(form.scheduleRunTime);
  const retentionNum = form.retentionCount.trim() === "" ? null : Number(form.retentionCount);
  const minKeepNum = form.retentionMinKeep.trim() === "" ? null : Number(form.retentionMinKeep);
  const retentionValid =
    retentionNum == null || (Number.isInteger(retentionNum) && retentionNum >= 1);
  const minKeepValid = minKeepNum == null || (Number.isInteger(minKeepNum) && minKeepNum >= 0);

  // Retention is being tightened when the new cap is lower than the old, or a cap
  // is introduced where none existed — older backups will then be archived.
  const loweringRetention =
    retentionNum != null &&
    (settings.retentionCount == null || retentionNum < settings.retentionCount);

  const formValid = runTimeValid && retentionValid && minKeepValid;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.patch<BackupSettings>("/backups/settings", {
        scheduleEnabled: form.scheduleEnabled,
        scheduleFrequency: form.scheduleFrequency,
        scheduleRunTime: form.scheduleRunTime,
        retentionCount: retentionNum,
        retentionMinKeep: minKeepNum,
        offsiteEnabled: form.offsiteEnabled,
        failureAlertEnabled: form.failureAlertEnabled,
        alertEmails: form.alertEmails.trim() === "" ? null : form.alertEmails.trim(),
      });
      setSettings(updated);
      setForm(toForm(updated));
      setConfirmOpen(false);
      toast.success("Backup settings saved.");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save settings");
      setConfirmOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const testOffsite = async () => {
    setTesting(true);
    try {
      const res = await api.post<{ ok: boolean; mode: string; detail?: string }>("/backups/offsite/test");
      if (res.ok) toast.success(`Off-site connection OK (${res.mode}).`);
      else toast.error(`Off-site test failed: ${res.detail ?? "unknown error"}`);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Off-site test failed");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Backup settings</h2>
        <Button onClick={() => setConfirmOpen(true)} disabled={!formValid || saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <ErrorNote message={error} />

      {/* Schedule */}
      <Card>
        <p className="mb-4 text-sm font-semibold text-ink">Schedule</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500/30"
              checked={form.scheduleEnabled}
              onChange={(e) => patch({ scheduleEnabled: e.target.checked })}
            />
            <span className="text-sm font-medium text-ink">Automatic scheduled backups</span>
          </label>
          <Field label="Frequency">
            <Select
              value={form.scheduleFrequency}
              onChange={(e) =>
                patch({ scheduleFrequency: e.target.value as BackupSettings["scheduleFrequency"] })
              }
              disabled={!form.scheduleEnabled}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </Select>
          </Field>
          <Field
            label="Run time (HH:MM)"
            error={form.scheduleRunTime && !runTimeValid ? "Use 24-hour HH:MM." : undefined}
          >
            <Input
              type="text"
              placeholder="02:00"
              value={form.scheduleRunTime}
              onChange={(e) => patch({ scheduleRunTime: e.target.value })}
              disabled={!form.scheduleEnabled}
            />
          </Field>
        </div>
        <p className="mt-3 text-xs text-faint">
          Next scheduled run:{" "}
          <span className="font-medium text-muted">
            {form.scheduleEnabled ? formatDateTime(settings.nextRunAt) : "Off"}
          </span>
        </p>
      </Card>

      {/* Retention */}
      <Card>
        <p className="mb-4 text-sm font-semibold text-ink">Retention</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Keep latest N backups"
            hint="Empty = keep all (retention off)."
            error={!retentionValid ? "Whole number ≥ 1, or empty." : undefined}
          >
            <Input
              type="number"
              min={1}
              step={1}
              placeholder="Off (keep all)"
              value={form.retentionCount}
              onChange={(e) => patch({ retentionCount: e.target.value })}
            />
          </Field>
          <Field
            label="Rollback window (min backups to keep)"
            hint="Protected from retention/archival."
            error={!minKeepValid ? "Whole number ≥ 0." : undefined}
          >
            <Input
              type="number"
              min={0}
              step={1}
              placeholder="e.g. 3"
              value={form.retentionMinKeep}
              onChange={(e) => patch({ retentionMinKeep: e.target.value })}
            />
          </Field>
        </div>
        {loweringRetention && (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Lowering retention will archive older backups beyond the new limit (down to the rollback
            window). This takes effect on the next retention sweep.
          </div>
        )}
      </Card>

      {/* Off-site replication */}
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink">Off-site replication</p>
          <Button variant="secondary" onClick={testOffsite} disabled={testing}>
            <Icon name="hardDrive" className="h-4 w-4" />
            {testing ? "Testing…" : "Test connection"}
          </Button>
        </div>

        {offsite ? (
          <dl className="mb-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <StatusRow label="Mode" value={<span className="uppercase">{offsite.mode}</span>} />
            <StatusRow
              label="Sync status"
              value={<Badge tone={syncStatusTone(offsite.syncStatus)}>{titleCase(offsite.syncStatus.replace(/_/g, " "))}</Badge>}
            />
            <StatusRow label="Configured" value={offsite.configured ? "Yes" : "No"} />
            <StatusRow label="Endpoint" value={offsite.endpointHost ?? "—"} />
            <StatusRow label="Bucket" value={offsite.bucket ?? "—"} />
            <StatusRow
              label="Last test"
              value={
                offsite.lastTestAt
                  ? `${formatDateTime(offsite.lastTestAt)} · ${offsite.lastTestOk ? "OK" : "Failed"}`
                  : "Never"
              }
            />
            {offsite.lastTestDetail && <StatusRow label="Detail" value={offsite.lastTestDetail} />}
            {offsite.note && <StatusRow label="Note" value={offsite.note} />}
          </dl>
        ) : (
          <p className="mb-4 text-xs text-faint">Off-site status unavailable.</p>
        )}

        <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500/30"
              checked={form.offsiteEnabled}
              onChange={(e) => patch({ offsiteEnabled: e.target.checked })}
            />
            <span className="text-sm font-medium text-ink">Replicate backups off-site</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500/30"
              checked={form.failureAlertEnabled}
              onChange={(e) => patch({ failureAlertEnabled: e.target.checked })}
            />
            <span className="text-sm font-medium text-ink">Email on backup / sync failure</span>
          </label>
          <div className="sm:col-span-2">
            <Field label="Alert emails" hint="Comma- or newline-separated. Empty to disable.">
              <Textarea
                rows={2}
                value={form.alertEmails}
                onChange={(e) => patch({ alertEmails: e.target.value })}
                placeholder="ops@school.edu, sre@school.edu"
              />
            </Field>
          </div>
        </div>
      </Card>

      {/* Encryption — honest, documented limitation */}
      <Card>
        <p className="mb-3 text-sm font-semibold text-ink">Encryption at rest</p>
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          <div className="mb-1 flex items-center gap-2 font-semibold">
            <Icon name="alert" className="h-4 w-4" />
            Not enabled — documented limitation
          </div>
          <p className="text-xs">
            {encryption?.warning ??
              "Backups are not encrypted at rest. Protect them with storage-level encryption and access controls until application-level encryption is implemented."}
          </p>
          {encryption && (
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
              <StatusRow label="Status" value={titleCase(encryption.status.replace(/_/g, " "))} />
              <StatusRow label="Algorithm" value={encryption.algorithm ?? "—"} />
              <StatusRow label="Key management" value={encryption.keyManagement ?? "—"} />
              <StatusRow
                label="At-rest acknowledged"
                value={encryption.atRestAcknowledged ? "Yes" : "No"}
              />
            </dl>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Save backup settings?"
        tone="primary"
        confirmLabel="Save settings"
        busy={saving}
        onConfirm={save}
        onClose={() => setConfirmOpen(false)}
        message={
          <div className="space-y-2">
            <p>Apply these schedule, retention and off-site settings?</p>
            {loweringRetention && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                You are lowering retention — older backups beyond the new limit will be archived.
              </p>
            )}
          </div>
        }
      />
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-40 shrink-0 font-medium text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{value}</dd>
    </div>
  );
}
