"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import {
  Badge,
  Button,
  ErrorNote,
  Field,
  Modal,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type { Backup, RestorePreview, RestoreRequestScope } from "@/types";
import { formatBytes, formatNumber } from "../../platform/_utils";
import {
  backupStatusTone,
  checksumLabel,
  checksumTone,
  formatDateTime,
  offsiteLabel,
  offsiteTone,
  shortId,
  triggerLabel,
} from "./taxonomy";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const MIN_DOWNLOAD_REASON = 5;
const MIN_RESTORE_REASON = 8;

type View = "menu" | "download" | "preview" | "request" | "archive";

/**
 * Per-backup action hub. Shows the full backup record and, gated on the artifact
 * and status, every governed action: verify checksum, download (reason ≥ 5),
 * restore preview, request restore (reason ≥ 8 + risk), test-restore dry-run and
 * archive (reason + override). High-risk actions carry danger/amber warnings.
 */
export function BackupDetailModal({
  backup,
  onClose,
  onChanged,
}: {
  backup: Backup | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [view, setView] = useState<View>("menu");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline result panels for the fire-and-forget actions.
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Sub-view field state.
  const [downloadReason, setDownloadReason] = useState("");
  const [restoreScope, setRestoreScope] = useState<RestoreRequestScope>("full");
  const [restoreReason, setRestoreReason] = useState("");
  const [riskReason, setRiskReason] = useState("");
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveOverride, setArchiveOverride] = useState(false);

  // Preview state.
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Reset everything when a new backup is opened.
  useEffect(() => {
    if (backup) {
      setView("menu");
      setBusy(false);
      setError(null);
      setVerifyResult(null);
      setTestResult(null);
      setDownloadReason("");
      setRestoreScope("full");
      setRestoreReason("");
      setRiskReason("");
      setArchiveReason("");
      setArchiveOverride(false);
      setPreview(null);
      setPreviewLoading(false);
    }
  }, [backup]);

  if (!backup) return null;
  const b = backup;
  const canRestore = b.hasArtifact;

  const goPreview = () => {
    setView("preview");
    setError(null);
    setPreview(null);
    setPreviewLoading(true);
    api
      .get<RestorePreview>(`/backups/${b.id}/restore/preview`)
      .then(setPreview)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load restore preview")
      )
      .finally(() => setPreviewLoading(false));
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    setVerifyResult(null);
    try {
      const res = await api.post<{ verified: boolean; checksumStatus: string; detail?: string }>(
        `/backups/${b.id}/verify`
      );
      const msg = res.verified
        ? "Checksum verified — backup integrity is intact."
        : `Checksum ${res.checksumStatus}${res.detail ? ` — ${res.detail}` : ""}.`;
      setVerifyResult(msg);
      if (res.verified) toast.success(msg);
      else toast.error(msg);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to verify checksum");
    } finally {
      setBusy(false);
    }
  };

  const testRestore = async () => {
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      const res = await api.post<{
        decoded: boolean;
        checksumStatus: string;
        schemaMatches: boolean;
        restorable: boolean;
        tableCount: number;
        totalRows: number;
        note?: string;
      }>(`/backups/${b.id}/test-restore`);
      const msg = res.restorable
        ? `Dry-run passed — ${formatNumber(res.tableCount)} tables / ${formatNumber(
            res.totalRows
          )} rows decode cleanly.`
        : `Dry-run flagged issues (checksum ${res.checksumStatus}, schema ${
            res.schemaMatches ? "matches" : "mismatch"
          }).`;
      setTestResult(`${msg}${res.note ? ` ${res.note}` : ""}`);
      if (res.restorable) toast.success("Test-restore dry-run passed.");
      else toast.error("Test-restore found issues.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to run test-restore");
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = useAuthStore.getState().accessToken;
      const res = await fetch(
        `${API_URL}/backups/${b.id}/download?reason=${encodeURIComponent(downloadReason.trim())}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      if (!res.ok) {
        let message = res.statusText;
        try {
          const d = await res.json();
          if (typeof d.error === "string") message = d.error;
        } catch {
          /* non-JSON error body — keep statusText */
        }
        throw new ApiError(res.status, message);
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `backup-${shortId(b.id)}.json.gz`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success("Backup download started.");
      setView("menu");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Download failed");
    } finally {
      setBusy(false);
    }
  };

  const requestRestore = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/backups/${b.id}/restore-requests`, {
        scope: restoreScope,
        reason: restoreReason.trim(),
        ...(riskReason.trim() ? { riskReason: riskReason.trim() } : {}),
      });
      toast.success("Restore request submitted for approval.");
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to submit restore request");
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/backups/${b.id}/archive`, {
        reason: archiveReason.trim(),
        ...(archiveOverride ? { override: true } : {}),
      });
      toast.success("Backup archived.");
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to archive backup");
    } finally {
      setBusy(false);
    }
  };

  const title =
    view === "menu"
      ? `Backup ${shortId(b.id)}`
      : view === "download"
        ? "Download backup"
        : view === "preview"
          ? "Restore preview"
          : view === "request"
            ? "Request restore"
            : "Archive backup";

  return (
    <Modal title={title} open={backup !== null} onClose={onClose}>
      {view === "menu" && (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={backupStatusTone(b.status)}>{b.status}</Badge>
            <Badge tone="slate">{triggerLabel(b.trigger)}</Badge>
            <Badge tone={b.scope === "global" ? "blue" : "slate"}>{b.scope}</Badge>
            <Badge tone={checksumTone(b.checksumStatus)}>{checksumLabel(b.checksumStatus)}</Badge>
            <Badge tone={offsiteTone(b.offsite)}>{offsiteLabel(b.offsite)}</Badge>
          </div>

          <dl className="space-y-2">
            <Row label="Created" value={formatDateTime(b.createdAt)} />
            <Row label="Completed" value={formatDateTime(b.completedAt)} />
            <Row label="Size" value={b.sizeBytes == null ? "—" : formatBytes(b.sizeBytes)} />
            <Row
              label="Tables / rows"
              value={`${b.tableCount == null ? "—" : formatNumber(b.tableCount)} / ${
                b.rowCount == null ? "—" : formatNumber(b.rowCount)
              }`}
            />
            <Row label="Schema version" value={b.schemaVersion == null ? "—" : `v${b.schemaVersion}`} />
            <Row label="Checksum algo" value={b.checksumAlgo ?? "—"} />
            {b.checksumVerifiedAt && (
              <Row label="Checksum verified" value={formatDateTime(b.checksumVerifiedAt)} />
            )}
            {b.archivedAt && (
              <Row
                label="Archived"
                value={`${formatDateTime(b.archivedAt)}${b.archiveReason ? ` — ${b.archiveReason}` : ""}`}
              />
            )}
            {b.error && <Row label="Error" value={<span className="text-red-600">{b.error}</span>} />}
            {b.logsSummary && <Row label="Logs" value={b.logsSummary} />}
          </dl>

          {verifyResult && (
            <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-ink">
              {verifyResult}
            </p>
          )}
          {testResult && (
            <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-ink">
              {testResult}
            </p>
          )}
          <ErrorNote message={error} />

          {!canRestore && (
            <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
              No artifact is stored for this backup, so download and restore actions are unavailable.
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            {canRestore && (
              <>
                <Button variant="secondary" onClick={verify} disabled={busy}>
                  <Icon name="shieldCheck" className="h-4 w-4" />
                  {busy ? "Working…" : "Verify checksum"}
                </Button>
                <Button variant="secondary" onClick={testRestore} disabled={busy}>
                  {busy ? "Working…" : "Test-restore (dry run)"}
                </Button>
                <Button variant="secondary" onClick={goPreview} disabled={busy}>
                  Restore preview
                </Button>
                <Button variant="secondary" className="!text-amber-600" onClick={() => setView("download")} disabled={busy}>
                  <Icon name="download" className="h-4 w-4" />
                  Download
                </Button>
                <Button variant="danger" onClick={() => setView("request")} disabled={busy}>
                  Request restore
                </Button>
              </>
            )}
            {b.status !== "archived" && (
              <Button variant="danger" onClick={() => setView("archive")} disabled={busy}>
                Archive
              </Button>
            )}
          </div>
        </div>
      )}

      {view === "download" && (
        <div className="space-y-4 text-sm">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Downloading a raw database backup is high-risk — it contains all tenant data. A reason is
            required and recorded in the audit log.
          </div>
          <Field
            label="Reason (min 5 characters)"
            error={
              downloadReason.length > 0 && downloadReason.trim().length < MIN_DOWNLOAD_REASON
                ? "At least 5 characters required."
                : undefined
            }
          >
            <Textarea
              rows={2}
              value={downloadReason}
              onChange={(e) => setDownloadReason(e.target.value)}
              placeholder="Why is this download needed?"
            />
          </Field>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setView("menu")} disabled={busy}>
              Back
            </Button>
            <Button
              variant="danger"
              onClick={download}
              disabled={busy || downloadReason.trim().length < MIN_DOWNLOAD_REASON}
            >
              {busy ? "Preparing…" : "Download backup"}
            </Button>
          </div>
        </div>
      )}

      {view === "preview" && (
        <div className="space-y-4 text-sm">
          {previewLoading ? (
            <Spinner />
          ) : error ? (
            <>
              <ErrorNote message={error} />
              <div className="flex justify-end">
                <Button variant="secondary" onClick={() => setView("menu")}>
                  Back
                </Button>
              </div>
            </>
          ) : preview ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={preview.restorable ? "green" : "red"}>
                  {preview.restorable ? "Restorable" : "Not restorable"}
                </Badge>
                <Badge tone={checksumTone(preview.checksumStatus)}>
                  {checksumLabel(preview.checksumStatus)}
                </Badge>
                <Badge tone={preview.schemaMatches ? "green" : "amber"}>
                  {preview.schemaMatches
                    ? "Schema matches"
                    : `Schema v${preview.schemaVersion} → v${preview.currentSchemaVersion}`}
                </Badge>
              </div>
              <dl className="space-y-2">
                <Row label="Scope" value={<span className="capitalize">{preview.scope}</span>} />
                <Row label="Created" value={formatDateTime(preview.createdAt)} />
                <Row label="Tables" value={formatNumber(preview.tableCount)} />
                <Row label="Total rows" value={formatNumber(preview.totalRows)} />
                <Row label="Downtime risk" value={<span className="capitalize">{preview.impact.downtimeRisk}</span>} />
              </dl>
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                {preview.impact.overwritesAllData
                  ? "Restoring this backup overwrites ALL current data. "
                  : ""}
                {preview.impact.recommendPreRestoreBackup
                  ? "A pre-restore safety backup is strongly recommended."
                  : ""}
              </div>
              {preview.tables.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-line">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-surface-2 text-muted">
                      <tr>
                        <th className="px-3 py-1.5">Table</th>
                        <th className="px-3 py-1.5 text-right">Rows</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {preview.tables.map((t) => (
                        <tr key={t.name}>
                          <td className="px-3 py-1.5 font-mono text-ink">{t.name}</td>
                          <td className="px-3 py-1.5 text-right text-muted">{formatNumber(t.rowCount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setView("menu")}>
                  Back
                </Button>
                <Button variant="danger" onClick={() => setView("request")} disabled={!preview.restorable}>
                  Request restore
                </Button>
              </div>
            </>
          ) : null}
        </div>
      )}

      {view === "request" && (
        <div className="space-y-4 text-sm">
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
            A restore request must be approved by another super admin before it can be executed.
            Executing a restore overwrites live data — describe the reason and any risk clearly.
          </div>
          <Field label="Restore scope">
            <Select
              value={restoreScope}
              onChange={(e) => setRestoreScope(e.target.value as RestoreRequestScope)}
            >
              <option value="full">Full</option>
              <option value="database">Database</option>
              <option value="files">Files</option>
              <option value="config">Config</option>
            </Select>
          </Field>
          <Field
            label="Reason (min 8 characters)"
            error={
              restoreReason.length > 0 && restoreReason.trim().length < MIN_RESTORE_REASON
                ? "At least 8 characters required."
                : undefined
            }
          >
            <Textarea
              rows={2}
              value={restoreReason}
              onChange={(e) => setRestoreReason(e.target.value)}
              placeholder="Why does the database need restoring?"
            />
          </Field>
          <Field label="Risk / blast-radius notes (optional)">
            <Textarea
              rows={2}
              value={riskReason}
              onChange={(e) => setRiskReason(e.target.value)}
              placeholder="Known impact, affected tenants, downtime window…"
            />
          </Field>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setView("menu")} disabled={busy}>
              Back
            </Button>
            <Button
              variant="danger"
              onClick={requestRestore}
              disabled={busy || restoreReason.trim().length < MIN_RESTORE_REASON}
            >
              {busy ? "Submitting…" : "Submit restore request"}
            </Button>
          </div>
        </div>
      )}

      {view === "archive" && (
        <div className="space-y-4 text-sm">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Archiving retires this backup from the available set. A reason is required. Protected
            backups (the latest, or within the rollback window) need the override below.
          </div>
          <Field label="Reason (required)">
            <Textarea
              rows={2}
              value={archiveReason}
              onChange={(e) => setArchiveReason(e.target.value)}
              placeholder="Why is this backup being archived?"
            />
          </Field>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-line text-red-600 focus:ring-red-500/30"
              checked={archiveOverride}
              onChange={(e) => setArchiveOverride(e.target.checked)}
            />
            <span className="text-xs text-muted">
              Override protection — archive even if this is the latest backup or within the rollback
              window.
            </span>
          </label>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setView("menu")} disabled={busy}>
              Back
            </Button>
            <Button variant="danger" onClick={archive} disabled={busy || archiveReason.trim().length === 0}>
              {busy ? "Archiving…" : "Archive backup"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 font-medium text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{value}</dd>
    </div>
  );
}
