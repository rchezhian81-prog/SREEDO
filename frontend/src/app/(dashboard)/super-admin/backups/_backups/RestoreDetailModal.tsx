"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, ErrorNote, Field, Input, Modal, Textarea } from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type { RestoreImpactPreview, RestoreRequest } from "@/types";
import { formatNumber } from "../../platform/_utils";
import {
  checksumLabel,
  checksumTone,
  formatDateTime,
  restoreStatusTone,
  shortId,
  titleCase,
} from "./taxonomy";

const MIN_DECISION_REASON = 5;

type View = "menu" | "approve" | "reject" | "cancel" | "execute";

/**
 * Restore-request detail + approval workflow. Pending requests can be approved /
 * rejected (reason ≥ 5, self-approval blocked server-side and surfaced here) or
 * cancelled. Approved requests open a high-friction Execute flow: the exact
 * confirmation phrase must be typed, a reason is required and — for production —
 * force must be checked. Every state shows the impact preview.
 */
export function RestoreDetailModal({
  request,
  onClose,
  onChanged,
}: {
  request: RestoreRequest | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [view, setView] = useState<View>("menu");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [force, setForce] = useState(false);

  useEffect(() => {
    if (request) {
      setView("menu");
      setBusy(false);
      setError(null);
      setReason("");
      setConfirmText("");
      setForce(false);
    }
  }, [request]);

  if (!request) return null;
  const r = request;

  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/backups/restore-requests/${r.id}/decide`, {
        decision,
        reason: reason.trim(),
      });
      toast.success(decision === "approved" ? "Restore request approved." : "Restore request rejected.");
      onChanged();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError(
          "You can't decide your own restore request — approval must come from another super admin."
        );
      } else {
        setError(err instanceof ApiError ? err.message : "Failed to submit decision");
      }
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/backups/restore-requests/${r.id}/cancel`, { reason: reason.trim() });
      toast.success("Restore request cancelled.");
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to cancel request");
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{
        executed: boolean;
        preRestoreBackupId: string | null;
        rowCount: number;
        tableCount: number;
      }>(`/backups/restore-requests/${r.id}/execute`, {
        confirmText: confirmText.trim(),
        reason: reason.trim(),
        force,
      });
      toast.success(
        `Restore executed — ${formatNumber(res.tableCount)} tables / ${formatNumber(
          res.rowCount
        )} rows restored.`
      );
      onChanged();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError("The confirmation phrase does not match. Type it exactly as shown.");
      } else if (err instanceof ApiError && err.status === 409) {
        setError("This request has already been executed or is no longer executable.");
      } else {
        setError(err instanceof ApiError ? err.message : "Failed to execute restore");
      }
    } finally {
      setBusy(false);
    }
  };

  const phraseMatches = r.confirmPhrase != null && confirmText.trim() === r.confirmPhrase;
  const decisionValid = reason.trim().length >= MIN_DECISION_REASON;

  const title =
    view === "menu"
      ? `Restore request ${shortId(r.id)}`
      : view === "approve"
        ? "Approve restore request"
        : view === "reject"
          ? "Reject restore request"
          : view === "cancel"
            ? "Cancel restore request"
            : "Execute restore";

  return (
    <Modal title={title} open={request !== null} onClose={onClose}>
      {view === "menu" && (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={restoreStatusTone(r.status)}>{titleCase(r.status)}</Badge>
            <Badge tone="slate">Scope: {r.scope}</Badge>
            {r.backupChecksumStatus && (
              <Badge tone={checksumTone(r.backupChecksumStatus)}>
                {checksumLabel(r.backupChecksumStatus)}
              </Badge>
            )}
          </div>

          <dl className="space-y-2">
            <Row
              label="Backup"
              value={
                <span>
                  <span className="font-mono text-xs">{shortId(r.backupId)}</span>{" "}
                  <span className="capitalize text-faint">({r.backupScope})</span>
                </span>
              }
            />
            <Row label="Backup created" value={formatDateTime(r.backupCreatedAt)} />
            <Row label="Requested" value={formatDateTime(r.createdAt)} />
            <Row label="Requester" value={r.requestedByEmail ?? r.requestedBy ?? "—"} />
            {r.reason && <Row label="Reason" value={r.reason} />}
            {r.riskReason && (
              <Row label="Risk" value={<span className="text-amber-600">{r.riskReason}</span>} />
            )}
            {(r.decidedByEmail || r.decidedBy) && (
              <Row
                label="Decided by"
                value={`${r.decidedByEmail ?? r.decidedBy}${
                  r.decidedAt ? ` · ${formatDateTime(r.decidedAt)}` : ""
                }`}
              />
            )}
            {r.decisionReason && <Row label="Decision note" value={r.decisionReason} />}
            {r.expiresAt && r.status === "approved" && (
              <Row label="Approval expires" value={formatDateTime(r.expiresAt)} />
            )}
            {r.status === "executed" && (
              <>
                <Row label="Executed" value={formatDateTime(r.executedAt)} />
                <Row label="Executed by" value={r.executedByEmail ?? r.executedBy ?? "—"} />
                {r.executionResult && <Row label="Result" value={r.executionResult} />}
                {r.executionDetail && <Row label="Detail" value={r.executionDetail} />}
                {r.preRestoreBackupId && (
                  <Row
                    label="Pre-restore backup"
                    value={<span className="font-mono text-xs">{shortId(r.preRestoreBackupId)}</span>}
                  />
                )}
              </>
            )}
          </dl>

          <ImpactPanel impact={r.impactPreview} />

          {r.status === "approved" && r.confirmPhrase && (
            <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs">
              <span className="text-muted">Confirmation phrase:</span>{" "}
              <span className="font-mono text-ink">{r.confirmPhrase}</span>
            </div>
          )}

          <ErrorNote message={error} />

          <div className="flex flex-wrap justify-end gap-2">
            {r.status === "pending" && (
              <>
                <Button onClick={() => setView("approve")} disabled={busy}>
                  <Icon name="check" className="h-4 w-4" />
                  Approve
                </Button>
                <Button variant="danger" onClick={() => setView("reject")} disabled={busy}>
                  Reject
                </Button>
                <Button variant="secondary" onClick={() => setView("cancel")} disabled={busy}>
                  Cancel request
                </Button>
              </>
            )}
            {r.status === "approved" && (
              <>
                <Button variant="danger" onClick={() => setView("execute")} disabled={busy}>
                  <Icon name="history" className="h-4 w-4" />
                  Execute restore
                </Button>
                <Button variant="secondary" onClick={() => setView("cancel")} disabled={busy}>
                  Cancel request
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {(view === "approve" || view === "reject") && (
        <div className="space-y-4 text-sm">
          <p className="text-muted">
            {view === "approve" ? "Approve" : "Reject"} the restore request for backup{" "}
            <span className="font-mono text-xs text-ink">{shortId(r.backupId)}</span>. This is audited.
            {view === "approve" &&
              " Approving lets the requester (or another admin) execute one destructive restore."}
          </p>
          <Field
            label="Decision reason (min 5 characters)"
            error={reason.length > 0 && !decisionValid ? "At least 5 characters required." : undefined}
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
              disabled={busy || !decisionValid}
            >
              {busy ? "Submitting…" : view === "approve" ? "Approve" : "Reject"}
            </Button>
          </div>
        </div>
      )}

      {view === "cancel" && (
        <div className="space-y-4 text-sm">
          <p className="text-muted">
            Cancel this restore request so it can no longer be executed. This is audited.
          </p>
          <Field label="Reason (required)">
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this request being cancelled?"
            />
          </Field>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setView("menu")} disabled={busy}>
              Back
            </Button>
            <Button variant="danger" onClick={cancel} disabled={busy || reason.trim().length === 0}>
              {busy ? "Cancelling…" : "Cancel request"}
            </Button>
          </div>
        </div>
      )}

      {view === "execute" && (
        <div className="space-y-4 text-sm">
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs font-semibold text-red-600 dark:text-red-400">
            Production restore is destructive and overwrites ALL data. A pre-restore safety backup is
            taken automatically, but current data not in the chosen backup will be permanently lost.
            This cannot be undone.
          </div>

          <ImpactPanel impact={r.impactPreview} />

          <Field
            label="Type the confirmation phrase exactly"
            hint={r.confirmPhrase ?? undefined}
            error={confirmText.length > 0 && !phraseMatches ? "Does not match." : undefined}
          >
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={r.confirmPhrase ?? "confirmation phrase"}
              autoComplete="off"
            />
          </Field>
          <Field label="Reason (required)">
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Final justification for executing this restore"
            />
          </Field>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-line text-red-600 focus:ring-red-500/30"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
            />
            <span className="text-xs text-muted">
              Force execute — required when restoring in production.
            </span>
          </label>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setView("menu")} disabled={busy}>
              Back
            </Button>
            <Button
              variant="danger"
              onClick={execute}
              disabled={busy || !phraseMatches || reason.trim().length === 0}
            >
              {busy ? "Restoring…" : "Execute restore"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Renders whatever impact fields the request captured, with an overwrite warning. */
function ImpactPanel({ impact }: { impact: RestoreImpactPreview | null }) {
  if (!impact) return null;
  const tables = Array.isArray(impact.tables) ? impact.tables : [];
  return (
    <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
      <p className="font-semibold">Impact preview</p>
      <dl className="space-y-1">
        {impact.tableCount != null && (
          <ImpactRow label="Tables affected" value={formatNumber(impact.tableCount)} />
        )}
        {impact.totalRows != null && (
          <ImpactRow label="Total rows" value={formatNumber(impact.totalRows)} />
        )}
        {impact.downtimeRisk != null && (
          <ImpactRow label="Downtime risk" value={<span className="capitalize">{impact.downtimeRisk}</span>} />
        )}
        {impact.overwritesAllData != null && (
          <ImpactRow label="Overwrites all data" value={impact.overwritesAllData ? "Yes" : "No"} />
        )}
        {impact.recommendPreRestoreBackup != null && (
          <ImpactRow
            label="Pre-restore backup"
            value={impact.recommendPreRestoreBackup ? "Recommended" : "Not required"}
          />
        )}
      </dl>
      {tables.length > 0 && (
        <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80">
          {tables
            .slice(0, 6)
            .map((t) => t.name)
            .join(", ")}
          {tables.length > 6 ? ` +${tables.length - 6} more` : ""}
        </p>
      )}
    </div>
  );
}

function ImpactRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
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
