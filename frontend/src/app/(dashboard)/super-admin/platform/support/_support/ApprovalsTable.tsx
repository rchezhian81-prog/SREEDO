"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  Field,
  Modal,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type {
  SupportApproval,
  SupportApprovalPage,
  SupportApprovalStatus,
} from "@/types";
import { formatNumber } from "../../_utils";
import {
  approvalLabel,
  approvalTone,
  formatDateTime,
  scopeLabel,
  scopeTone,
  templateLabel,
} from "./taxonomy";

const MIN_REASON = 5;
const STATUS_OPTIONS: { value: "" | SupportApprovalStatus; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

type DecideTarget = { approval: SupportApproval; decision: "approved" | "rejected" };

/**
 * Support-access approval workflow (Phase 2, L). Lists pre-approval requests for
 * would-be high-risk (write-enabled) sessions and lets an approver approve/reject a
 * pending one (reason required). A non-approver's decision is blocked by the server
 * (403 on `platform:support_approve`) and surfaced gracefully in the dialog.
 */
export function ApprovalsTable({ reloadKey }: { reloadKey: number }) {
  const [status, setStatus] = useState<"" | SupportApprovalStatus>("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [data, setData] = useState<SupportApprovalPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decideTarget, setDecideTarget] = useState<DecideTarget | null>(null);

  useEffect(() => {
    setPage(1);
  }, [status]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (status) p.set("status", status);
      p.set("page", String(page));
      p.set("pageSize", String(pageSize));
      setData(await api.get<SupportApprovalPage>(`/platform/support/approvals?${p.toString()}`));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load approval requests");
    } finally {
      setLoading(false);
    }
  }, [status, page, pageSize]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const decide = async (reason: string) => {
    if (!decideTarget) return;
    try {
      await api.post(`/platform/support/approvals/${decideTarget.approval.id}/decide`, {
        decision: decideTarget.decision,
        reason,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        throw new Error(
          "You don't have permission to decide support approvals (needs platform:support_approve)."
        );
      }
      throw err instanceof ApiError ? new Error(err.message) : err;
    }
    toast.success(decideTarget.decision === "approved" ? "Request approved." : "Request rejected.");
    await load();
  };

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Status</span>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as "" | SupportApprovalStatus)}
            className="min-w-48"
            aria-label="Approval status"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
        <p className="max-w-md text-xs text-faint">
          A write-enabled support session must reference an approved request. Approving or rejecting
          is audited; nothing here is ever deleted.
        </p>
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No approval requests match this filter." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Requested</th>
                  <th className="px-4 py-3">Requester</th>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3">Scope</th>
                  <th className="px-4 py-3">Reason / risk</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((a) => (
                  <tr key={a.id} className="align-top hover:bg-hover">
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDateTime(a.createdAt)}</td>
                    <td className="px-4 py-3 text-muted">{a.requestedByEmail ?? a.requestedBy ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className="block text-ink">{a.targetEmail ?? a.targetId}</span>
                      {a.institutionName && (
                        <span className="block text-xs text-faint">
                          {a.institutionName}
                          {a.institutionCode ? ` (${a.institutionCode})` : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={scopeTone(a.scope)}>{scopeLabel(a.scope)}</Badge>
                      {a.reasonTemplate && (
                        <span className="mt-1 block text-xs text-faint">{templateLabel(a.reasonTemplate)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="block max-w-[18rem] whitespace-normal break-words text-ink">
                        {a.reason ?? "—"}
                      </span>
                      {a.riskReason && (
                        <span className="mt-1 block max-w-[18rem] whitespace-normal break-words text-xs text-amber-600">
                          Risk: {a.riskReason}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={approvalTone(a.status)}>{approvalLabel(a.status)}</Badge>
                      {a.status !== "pending" && (a.decidedByEmail || a.decisionReason) && (
                        <span className="mt-1 block max-w-[16rem] whitespace-normal break-words text-xs text-faint">
                          {a.decidedByEmail ? `by ${a.decidedByEmail}` : ""}
                          {a.decisionReason ? ` — ${a.decisionReason}` : ""}
                        </span>
                      )}
                      {a.consumedAt && <span className="mt-1 block text-xs text-faint">Consumed</span>}
                    </td>
                    <td className="px-4 py-3">
                      {a.status === "pending" ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            className="!px-3 !py-1.5"
                            onClick={() => setDecideTarget({ approval: a, decision: "approved" })}
                          >
                            <Icon name="check" className="h-4 w-4" />
                            Approve
                          </Button>
                          <Button
                            variant="danger"
                            className="!px-3 !py-1.5"
                            onClick={() => setDecideTarget({ approval: a, decision: "rejected" })}
                          >
                            Reject
                          </Button>
                        </div>
                      ) : (
                        <span className="block text-right text-xs text-faint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 text-sm text-muted">
            <span>
              Page {page} of {totalPages} · {formatNumber(total)} total
            </span>
            <Button variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              ← Prev
            </Button>
            <Button
              variant="secondary"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next →
            </Button>
          </div>
        </>
      )}

      <DecideModal target={decideTarget} onConfirm={decide} onClose={() => setDecideTarget(null)} />
    </div>
  );
}

/** Reason-required approve/reject dialog. */
function DecideModal({
  target,
  onConfirm,
  onClose,
}: {
  target: DecideTarget | null;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target) {
      setReason("");
      setError(null);
      setBusy(false);
    }
  }, [target]);

  const approve = target?.decision === "approved";
  const valid = reason.trim().length >= MIN_REASON;

  const submit = async () => {
    if (!valid) {
      setError(`Enter a reason of at least ${MIN_REASON} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit decision");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={approve ? "Approve support request" : "Reject support request"}
      open={target !== null}
      onClose={onClose}
    >
      <div className="space-y-4 text-sm">
        {target && (
          <p className="text-muted">
            {approve ? "Approve" : "Reject"} a{" "}
            <span className="font-semibold text-ink">{scopeLabel(target.approval.scope)}</span> support
            request for{" "}
            <span className="font-semibold text-ink">
              {target.approval.targetEmail ?? target.approval.targetId}
            </span>
            {approve ? ". The requester can then start one write-enabled session with it." : "."} This
            is audited.
          </p>
        )}
        <Field label="Decision reason (required)" error={error ?? undefined}>
          <Textarea
            rows={3}
            placeholder="Why is this being approved / rejected? (ticket reference, risk sign-off…)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={approve ? "primary" : "danger"} onClick={submit} disabled={busy || !valid}>
            {busy ? "Submitting…" : approve ? "Approve" : "Reject"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
