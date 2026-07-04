"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorNote,
  Field,
  Input,
  Spinner,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import type { AuditRetention } from "@/types";
import { formatNumber } from "../../_utils";
import { formatDateTime, type Tone } from "./taxonomy";

const STATUS_TONE: Record<AuditRetention["status"], Tone> = {
  not_configured: "slate",
  configured: "blue",
  archived: "green",
};

const STATUS_LABEL: Record<AuditRetention["status"], string> = {
  not_configured: "Not configured",
  configured: "Configured",
  archived: "Archive enabled",
};

/**
 * Retention policy card. Shows the policy + live store stats, and offers a
 * guarded, confirm-gated edit. This is POLICY VISIBILITY ONLY — saving never
 * deletes audit history. A caller lacking platform:audit_manage gets a friendly
 * note instead of a crash (server returns 403).
 */
export function RetentionCard() {
  const [data, setData] = useState<AuditRetention | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [daysInput, setDaysInput] = useState("");
  const [archive, setArchive] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<AuditRetention>("/platform/audit/retention"));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load retention policy");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const startEdit = () => {
    if (!data) return;
    setDaysInput(data.retentionDays == null ? "" : String(data.retentionDays));
    setArchive(data.archiveEnabled);
    setSaveError(null);
    setEditing(true);
  };

  const trimmed = daysInput.trim();
  const parsedDays = trimmed === "" ? null : Number(trimmed);
  const daysInvalid =
    trimmed !== "" &&
    (!Number.isInteger(parsedDays) || (parsedDays as number) < 30 || (parsedDays as number) > 3650);

  const save = async () => {
    setBusy(true);
    setSaveError(null);
    try {
      const updated = await api.put<AuditRetention>("/platform/audit/retention", {
        retentionDays: parsedDays,
        archiveEnabled: archive,
      });
      setData(updated);
      setConfirmOpen(false);
      setEditing(false);
    } catch (err) {
      setConfirmOpen(false);
      if (err instanceof ApiError && err.status === 403) {
        setSaveError("You don't have permission to change the retention policy.");
      } else {
        setSaveError(err instanceof ApiError ? err.message : "Failed to update policy");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon name="clipboard" className="h-5 w-5 text-slate-400" />
          <h3 className="text-base font-semibold text-slate-800">Retention policy</h3>
        </div>
        {data && <Badge tone={STATUS_TONE[data.status]}>{STATUS_LABEL[data.status]}</Badge>}
      </div>

      <p className="mb-4 text-xs text-slate-400">
        Policy visibility only — changing this never deletes audit history. An
        automated purge/archive job is a documented future enhancement.
      </p>

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : data ? (
        <>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Stat label="Retention window">
              {data.retentionDays == null ? "Not set (keep all)" : `${data.retentionDays} days`}
            </Stat>
            <Stat label="Archive">{data.archiveEnabled ? "Enabled" : "Disabled"}</Stat>
            <Stat label="Total events">{formatNumber(data.stats.totalEvents)}</Stat>
            <Stat label="Oldest event">{formatDateTime(data.stats.oldestEventAt)}</Stat>
            <Stat label="Last updated by">{data.updatedByEmail ?? "—"}</Stat>
            <Stat label="Updated at">{formatDateTime(data.updatedAt)}</Stat>
          </dl>

          {data.stats.growingLargeWarning && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              The audit store is growing large — consider planning an archive window.
            </div>
          )}

          {!editing ? (
            <div className="mt-4">
              <Button variant="secondary" onClick={startEdit}>
                Edit policy
              </Button>
            </div>
          ) : (
            <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <Field
                label="Retention window (days)"
                hint="30–3650, or leave blank to keep all history."
                error={daysInvalid ? "Enter a whole number between 30 and 3650." : undefined}
              >
                <Input
                  type="number"
                  min={30}
                  max={3650}
                  value={daysInput}
                  onChange={(e) => setDaysInput(e.target.value)}
                  placeholder="Not configured"
                />
              </Field>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={archive}
                  onChange={(e) => setArchive(e.target.checked)}
                />
                Enable archiving (visibility flag only)
              </label>
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setEditing(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button onClick={() => setConfirmOpen(true)} disabled={busy || daysInvalid}>
                  Save policy
                </Button>
              </div>
            </div>
          )}

          <div className="mt-3">
            <ErrorNote message={saveError} />
          </div>
        </>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        tone="primary"
        title="Update retention policy"
        message={
          <>
            Set the retention window to{" "}
            <span className="font-semibold">
              {parsedDays == null ? "keep all history" : `${parsedDays} days`}
            </span>{" "}
            {archive ? "with archiving enabled" : "with archiving disabled"}? This
            updates policy visibility only and never deletes existing audit records.
          </>
        }
        confirmLabel="Update policy"
        busy={busy}
        onConfirm={save}
        onClose={() => setConfirmOpen(false)}
      />
    </Card>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{children}</dd>
    </div>
  );
}
