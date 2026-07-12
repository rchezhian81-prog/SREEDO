"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import { formatDate } from "@/lib/format";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  Field,
  Modal,
  PageHeader,
  Spinner,
  Textarea,
} from "@/components/ui";
import type { LeaveRequest } from "@/types";

export default function LeaveApprovalsPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canApprove = can("leave:approve");
  const canReject = can("leave:reject");

  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [decision, setDecision] = useState<{
    request: LeaveRequest;
    type: "approve" | "reject";
  } | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setRequests(
        await api.get<LeaveRequest[]>("/leave/requests?status=pending")
      );
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load requests"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (permsLoading || !(canApprove || canReject)) return;
    load();
  }, [permsLoading, canApprove, canReject, load]);

  const openDecision = (request: LeaveRequest, type: "approve" | "reject") => {
    setDecision({ request, type });
    setNote("");
    setActionError(null);
  };

  const submitDecision = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!decision) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await api.post(`/leave/requests/${decision.request.id}/${decision.type}`, {
        note: note || undefined,
      });
      setDecision(null);
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to record decision"
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Leave approvals" subtitle="Pending leave requests" />
        <Spinner />
      </>
    );
  }

  if (!canApprove && !canReject) {
    return (
      <>
        <PageHeader title="Leave approvals" subtitle="Pending leave requests" />
        <EmptyState message="You do not have permission to approve or reject leave." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Leave approvals" subtitle="Pending leave requests" />

      <div className="mb-4">
        <Link
          href="/leave"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Leave
        </Link>
      </div>

      <div className="mb-3 space-y-2">
        <ErrorNote message={actionError} />
        <ErrorNote message={loadError} />
      </div>

      {loading ? (
        <Spinner />
      ) : requests.length === 0 ? (
        <EmptyState message="No pending leave requests" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Staff</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">From</th>
                <th className="px-4 py-3">To</th>
                <th className="px-4 py-3">Days</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {requests.map((request) => (
                <tr key={request.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {request.teacherName}
                  </td>
                  <td className="px-4 py-3">
                    {request.leaveTypeName}{" "}
                    <Badge tone={request.isPaid ? "green" : "slate"}>
                      {request.isPaid ? "paid" : "unpaid"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {formatDate(request.startDate)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {formatDate(request.endDate)}
                  </td>
                  <td className="px-4 py-3">{Number(request.days)}</td>
                  <td className="px-4 py-3 max-w-[14rem] truncate">
                    {request.reason ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-3">
                      {canApprove && (
                        <button
                          onClick={() => openDecision(request, "approve")}
                          className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
                        >
                          Approve
                        </button>
                      )}
                      {canReject && (
                        <button
                          onClick={() => openDecision(request, "reject")}
                          className="text-xs font-medium text-red-600 hover:text-red-700"
                        >
                          Reject
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        title={decision?.type === "approve" ? "Approve leave" : "Reject leave"}
        open={decision !== null}
        onClose={() => setDecision(null)}
      >
        {decision && (
          <form onSubmit={submitDecision} className="space-y-4">
            <p className="text-sm text-slate-600">
              {decision.request.teacherName} —{" "}
              {decision.request.leaveTypeName} ({Number(decision.request.days)} day
              {Number(decision.request.days) === 1 ? "" : "s"}),{" "}
              {formatDate(decision.request.startDate)} to{" "}
              {formatDate(decision.request.endDate)}
            </p>
            <Field label="Note (optional)">
              <Textarea
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
            <ErrorNote message={actionError} />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDecision(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant={decision.type === "reject" ? "danger" : "primary"}
                disabled={submitting}
              >
                {submitting
                  ? "Saving…"
                  : decision.type === "approve"
                    ? "Approve"
                    : "Reject"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
