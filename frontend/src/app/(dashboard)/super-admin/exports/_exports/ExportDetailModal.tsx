"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { Badge, Button, ErrorNote, Field, Modal, Spinner, Textarea } from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type { PlatformExport } from "@/types";
import { formatBytes, formatNumber } from "../../platform/_utils";
import {
  approvalLabel,
  approvalTone,
  exportStatusTone,
  formatDateTime,
  formatExt,
  formatLabel,
  isDownloadable,
  isNearingExpiry,
  scopeLabel,
  shortId,
} from "./taxonomy";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const MIN_DOWNLOAD_REASON = 5;
const MIN_ARCHIVE_REASON = 5;
const MIN_DECISION_REASON = 5;
const MIN_CANCEL_REASON = 5;

type View = "menu" | "manifest" | "download" | "cancel" | "archive" | "approve" | "reject";

/**
 * Per-export action hub. Shows the full export record and, gated on state, every
 * governed action: view the masked manifest, download (reason ≥ 5, high-risk),
 * cancel a pending/running export, archive a completed one (reason, artifact
 * removed but metadata kept) and approve / reject a pending request (reason ≥ 5,
 * self-approval blocked server-side and surfaced here).
 */
export function ExportDetailModal({
  row,
  onClose,
  onChanged,
}: {
  row: PlatformExport | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [view, setView] = useState<View>("menu");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reason, setReason] = useState("");

  // Manifest sub-view state.
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  const [manifestLoading, setManifestLoading] = useState(false);

  useEffect(() => {
    if (row) {
      setView("menu");
      setBusy(false);
      setError(null);
      setReason("");
      setManifest(null);
      setManifestLoading(false);
    }
  }, [row]);

  if (!row) return null;
  const r = row;

  const downloadable = isDownloadable(r);
  const canCancel = r.status === "pending" || r.status === "running";
  const canArchive = r.status === "completed" && !r.archivedAt;
  const canDecide = r.approvalStatus === "pending";

  const goManifest = () => {
    setView("manifest");
    setError(null);
    setManifest(null);
    setManifestLoading(true);
    api
      .get<Record<string, unknown>>(`/exports/${r.id}/manifest`)
      .then(setManifest)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load manifest")
      )
      .finally(() => setManifestLoading(false));
  };

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = useAuthStore.getState().accessToken;
      const res = await fetch(
        `${API_URL}/exports/${r.id}/download?reason=${encodeURIComponent(reason.trim())}`,
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
      a.download = `export-${r.scope}-${shortId(r.id)}.${formatExt(r.format)}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success("Export download started.");
      onChanged();
      setView("menu");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Download failed");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/exports/${r.id}/cancel`, reason.trim() ? { reason: reason.trim() } : {});
      toast.success("Export cancelled.");
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to cancel export");
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/exports/${r.id}/archive`, { reason: reason.trim() });
      toast.success("Export archived — its artifact was removed, metadata retained.");
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to archive export");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/exports/${r.id}/decide`, { decision, reason: reason.trim() });
      toast.success(decision === "approved" ? "Export approved and generated." : "Export rejected.");
      onChanged();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError(
          "You can't approve your own export request — approval must come from another super admin."
        );
      } else {
        setError(err instanceof ApiError ? err.message : "Failed to submit decision");
      }
    } finally {
      setBusy(false);
    }
  };

  const reasonLen = reason.trim().length;
  const title =
    view === "menu"
      ? `Export ${shortId(r.id)}`
      : view === "manifest"
        ? "Export manifest"
        : view === "download"
          ? "Download export"
          : view === "cancel"
            ? "Cancel export"
            : view === "archive"
              ? "Archive export"
              : view === "approve"
                ? "Approve export"
                : "Reject export";

  return (
    <Modal title={title} open={row !== null} onClose={onClose}>
      {view === "menu" && (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={exportStatusTone(r.status)}>{r.status}</Badge>
            {r.sensitive && (
              <Badge tone="red">
                <Icon name="shieldAlert" className="h-3.5 w-3.5" />
                Sensitive
              </Badge>
            )}
            <Badge tone={approvalTone(r.approvalStatus)}>{approvalLabel(r.approvalStatus)}</Badge>
            {r.archivedAt && <Badge tone="slate">Archived</Badge>}
            {isNearingExpiry(r) && <Badge tone="amber">Nearing expiry</Badge>}
          </div>

          <dl className="space-y-2">
            <Row label="Name" value={r.name} />
            <Row label="Scope" value={scopeLabel(r.scope)} />
            <Row label="Format" value={formatLabel(r.format)} />
            <Row label="Tenant" value={r.institutionId ? shortId(r.institutionId) : "All tenants"} />
            <Row label="Created" value={formatDateTime(r.createdAt)} />
            <Row label="Completed" value={formatDateTime(r.completedAt)} />
            <Row label="Rows" value={r.rowCount == null ? "—" : formatNumber(r.rowCount)} />
            <Row label="Files" value={r.fileCount == null ? "—" : formatNumber(r.fileCount)} />
            <Row label="Size" value={r.sizeBytes == null ? "—" : formatBytes(r.sizeBytes)} />
            <Row label="Checksum" value={r.checksum ? `${r.checksumAlgo ?? "sha256"} · ${r.checksum.slice(0, 16)}…` : "—"} />
            <Row label="Expires" value={formatDateTime(r.expiresAt)} />
            <Row label="Downloads" value={formatNumber(r.downloadCount)} />
            {r.lastDownloadedAt && <Row label="Last downloaded" value={formatDateTime(r.lastDownloadedAt)} />}
            {r.reason && <Row label="Reason" value={r.reason} />}
            {r.approvalReason && <Row label="Decision note" value={r.approvalReason} />}
            {r.archivedAt && (
              <Row
                label="Archived"
                value={`${formatDateTime(r.archivedAt)}${r.archiveReason ? ` — ${r.archiveReason}` : ""}`}
              />
            )}
            {r.scheduleId && <Row label="From schedule" value={shortId(r.scheduleId)} />}
            {r.error && <Row label="Error" value={<span className="text-red-600">{r.error}</span>} />}
          </dl>

          {r.filters && Object.keys(r.filters).length > 0 && (
            <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
              <p className="mb-1 text-xs font-semibold text-muted">Filters</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-ink">
                {JSON.stringify(r.filters, null, 2)}
              </pre>
            </div>
          )}

          <ErrorNote message={error} />

          {!downloadable && !canCancel && !canArchive && !canDecide && (
            <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
              No actions are available for this export in its current state.
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={goManifest} disabled={busy}>
              <Icon name="file" className="h-4 w-4" />
              View manifest
            </Button>
            {canDecide && (
              <>
                <Button onClick={() => setView("approve")} disabled={busy}>
                  <Icon name="check" className="h-4 w-4" />
                  Approve
                </Button>
                <Button variant="danger" onClick={() => setView("reject")} disabled={busy}>
                  Reject
                </Button>
              </>
            )}
            {downloadable && (
              <Button
                variant="secondary"
                className="!text-amber-600"
                onClick={() => setView("download")}
                disabled={busy}
              >
                <Icon name="download" className="h-4 w-4" />
                Download
              </Button>
            )}
            {canCancel && (
              <Button variant="secondary" onClick={() => setView("cancel")} disabled={busy}>
                Cancel export
              </Button>
            )}
            {canArchive && (
              <Button variant="danger" onClick={() => setView("archive")} disabled={busy}>
                Archive
              </Button>
            )}
          </div>
        </div>
      )}

      {view === "manifest" && (
        <div className="space-y-4 text-sm">
          {manifestLoading ? (
            <Spinner />
          ) : error ? (
            <ErrorNote message={error} />
          ) : manifest ? (
            <div className="max-h-[55vh] overflow-auto rounded-lg border border-line bg-surface-2 p-3">
              <pre className="whitespace-pre-wrap break-words text-xs text-ink">
                {JSON.stringify(manifest, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="text-muted">No manifest available for this export.</p>
          )}
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setView("menu")}>
              Back
            </Button>
          </div>
        </div>
      )}

      {view === "download" && (
        <div className="space-y-4 text-sm">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Downloading an export artifact is high-risk and audited{r.sensitive ? " — this is a sensitive dataset" : ""}.
            A reason is required and recorded in the platform audit log.
          </div>
          <Field
            label="Reason (min 5 characters)"
            error={reason.length > 0 && reasonLen < MIN_DOWNLOAD_REASON ? "At least 5 characters required." : undefined}
          >
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this download needed?"
            />
          </Field>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setView("menu")} disabled={busy}>
              Back
            </Button>
            <Button variant="danger" onClick={download} disabled={busy || reasonLen < MIN_DOWNLOAD_REASON}>
              {busy ? "Preparing…" : "Download export"}
            </Button>
          </div>
        </div>
      )}

      {view === "cancel" && (
        <div className="space-y-4 text-sm">
          <p className="text-muted">
            Cancel this {r.status} export so it will not be generated. This is audited.
          </p>
          <Field
            label="Reason (optional — min 5 characters)"
            error={reason.length > 0 && reasonLen < MIN_CANCEL_REASON ? "At least 5 characters required." : undefined}
          >
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this export being cancelled?"
            />
          </Field>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setView("menu")} disabled={busy}>
              Back
            </Button>
            <Button
              variant="danger"
              onClick={cancel}
              disabled={busy || (reason.length > 0 && reasonLen < MIN_CANCEL_REASON)}
            >
              {busy ? "Cancelling…" : "Cancel export"}
            </Button>
          </div>
        </div>
      )}

      {view === "archive" && (
        <div className="space-y-4 text-sm">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Archiving removes the downloadable artifact. The export&apos;s metadata row is retained for
            the audit trail. A reason is required.
          </div>
          <Field
            label="Reason (required — min 5 characters)"
            error={reason.length > 0 && reasonLen < MIN_ARCHIVE_REASON ? "At least 5 characters required." : undefined}
          >
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this export being archived?"
            />
          </Field>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setView("menu")} disabled={busy}>
              Back
            </Button>
            <Button variant="danger" onClick={archive} disabled={busy || reasonLen < MIN_ARCHIVE_REASON}>
              {busy ? "Archiving…" : "Archive export"}
            </Button>
          </div>
        </div>
      )}

      {(view === "approve" || view === "reject") && (
        <div className="space-y-4 text-sm">
          <div
            className={`rounded-lg border px-3 py-2 text-xs ${
              view === "approve"
                ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                : "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
            }`}
          >
            {view === "approve"
              ? "Approving generates the artifact immediately. You cannot approve your own request — a different super admin must approve it."
              : "Rejecting cancels this export request. It will not be generated."}
          </div>
          <Field
            label="Decision reason (min 5 characters)"
            error={reason.length > 0 && reasonLen < MIN_DECISION_REASON ? "At least 5 characters required." : undefined}
          >
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ticket reference, risk sign-off…"
            />
          </Field>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setView("menu")} disabled={busy}>
              Back
            </Button>
            <Button
              variant={view === "approve" ? "primary" : "danger"}
              onClick={() => decide(view === "approve" ? "approved" : "rejected")}
              disabled={busy || reasonLen < MIN_DECISION_REASON}
            >
              {busy ? "Submitting…" : view === "approve" ? "Approve" : "Reject"}
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
