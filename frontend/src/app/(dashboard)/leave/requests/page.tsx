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
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import type {
  LeaveRequest,
  LeaveRequestStatus,
  LeaveType,
  Paginated,
  Teacher,
} from "@/types";

const STATUS_TONE: Record<
  LeaveRequestStatus,
  "amber" | "green" | "red" | "slate"
> = {
  pending: "amber",
  approved: "green",
  rejected: "red",
  cancelled: "slate",
};

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

export default function LeaveRequestsPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canCreate = can("leave:create");
  // Admin/HR can pick a staff member and cancel any request.
  const isAdmin = can("leave:approve");

  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    teacherId: "",
    leaveTypeId: "",
    startDate: "",
    endDate: "",
    reason: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (selectedStatus: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = selectedStatus ? `?status=${selectedStatus}` : "";
      setRequests(await api.get<LeaveRequest[]>(`/leave/requests${qs}`));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load requests"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (permsLoading || !can("leave:read")) return;
    load(status);
  }, [permsLoading, can, load, status]);

  useEffect(() => {
    if (permsLoading || !canCreate) return;
    api
      .get<LeaveType[]>("/leave/types")
      .then((types) => setLeaveTypes(types.filter((t) => t.isActive)))
      .catch(() => undefined);
    if (isAdmin) {
      api
        .get<Paginated<Teacher>>("/teachers?limit=200")
        .then((page) => setTeachers(page.data))
        .catch(() => undefined);
    }
  }, [permsLoading, canCreate, isAdmin]);

  const openCreate = () => {
    setForm({
      teacherId: "",
      leaveTypeId: leaveTypes[0]?.id ?? "",
      startDate: "",
      endDate: "",
      reason: "",
    });
    setFormError(null);
    setModalOpen(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post("/leave/requests", {
        teacherId: isAdmin && form.teacherId ? form.teacherId : undefined,
        leaveTypeId: form.leaveTypeId,
        startDate: form.startDate,
        endDate: form.endDate,
        reason: form.reason || undefined,
      });
      setModalOpen(false);
      await load(status);
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to submit request"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const cancelRequest = async (request: LeaveRequest) => {
    if (!confirm("Cancel this leave request?")) return;
    setActionError(null);
    try {
      await api.post(`/leave/requests/${request.id}/cancel`);
      await load(status);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to cancel request"
      );
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Leave requests" subtitle="View & request leave" />
        <Spinner />
      </>
    );
  }

  if (!can("leave:read")) {
    return (
      <>
        <PageHeader title="Leave requests" subtitle="View & request leave" />
        <EmptyState message="You do not have access to leave requests." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Leave requests"
        subtitle="View & request leave"
        action={
          canCreate ? (
            <Button onClick={openCreate}>+ Request leave</Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Link
          href="/leave"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Leave
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-56">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Status
          </span>
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="mb-3 space-y-2">
        <ErrorNote message={actionError} />
        <ErrorNote message={loadError} />
      </div>

      {loading ? (
        <Spinner />
      ) : requests.length === 0 ? (
        <EmptyState message="No leave requests" />
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
                <th className="px-4 py-3">Status</th>
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
                    {request.leaveTypeName}
                    {!request.isPaid && (
                      <span className="ml-1 text-xs text-slate-400">
                        (unpaid)
                      </span>
                    )}
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
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[request.status]}>
                      {request.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {request.status === "pending" && (
                      <button
                        onClick={() => cancelRequest(request)}
                        className="text-xs font-medium text-red-600 hover:text-red-700"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        title="Request leave"
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={submit} className="space-y-4">
          {isAdmin && (
            <Field label="Staff (leave blank for yourself)">
              <Select
                value={form.teacherId}
                onChange={(event) =>
                  setForm((f) => ({ ...f, teacherId: event.target.value }))
                }
              >
                <option value="">Myself</option>
                {teachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.firstName} {teacher.lastName} ({teacher.employeeNo})
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Leave type">
            <Select
              value={form.leaveTypeId}
              required
              onChange={(event) =>
                setForm((f) => ({ ...f, leaveTypeId: event.target.value }))
              }
            >
              <option value="" disabled>
                Select a type
              </option>
              {leaveTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name} {type.isPaid ? "(paid)" : "(unpaid)"}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date">
              <Input
                type="date"
                value={form.startDate}
                required
                onChange={(event) =>
                  setForm((f) => ({ ...f, startDate: event.target.value }))
                }
              />
            </Field>
            <Field label="End date">
              <Input
                type="date"
                value={form.endDate}
                required
                onChange={(event) =>
                  setForm((f) => ({ ...f, endDate: event.target.value }))
                }
              />
            </Field>
          </div>
          <Field label="Reason (optional)">
            <Textarea
              rows={3}
              value={form.reason}
              onChange={(event) =>
                setForm((f) => ({ ...f, reason: event.target.value }))
              }
            />
          </Field>
          <ErrorNote message={formError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit request"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
