"use client";

import { useCallback, useEffect, useState } from "react";
import { portalApi } from "@/lib/portal-api";
import { ApiError } from "@/lib/api";
import { usePortalStore } from "@/stores/portal-store";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
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
import type { PortalLeaveRequest, PortalLeaveType } from "@/types";
import { useI18n } from "@/i18n/I18nProvider";
import {
  canCancel,
  dateRangeValid,
  LEAVE_TYPE_LABELS,
  statusTone,
  typeLabel,
} from "./helpers";

const formatDate = (value: string) => new Date(value).toLocaleDateString();

const errMsg = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback;

const EMPTY_FORM = { studentId: "", type: "sick" as PortalLeaveType, fromDate: "", toDate: "", reason: "" };

export default function PortalLeavePage() {
  const { t } = useI18n();
  const user = usePortalStore((state) => state.user);
  const kids = usePortalStore((state) => state.children);
  const selectedStudentId = usePortalStore((state) => state.selectedStudentId);
  const isStudent = user?.role === "student";

  const [rows, setRows] = useState<PortalLeaveRequest[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [cancelTarget, setCancelTarget] = useState<PortalLeaveRequest | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await portalApi.get<PortalLeaveRequest[]>("/student-leave/my"));
    } catch (err) {
      setError(errMsg(err, "Could not load leave requests."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isStudent) {
      setLoading(false);
      return;
    }
    load();
  }, [isStudent, load]);

  const openForm = () => {
    setNotice(null);
    setFormError(null);
    setForm({
      ...EMPTY_FORM,
      studentId:
        kids.find((k) => k.id === selectedStudentId)?.id ?? kids[0]?.id ?? "",
    });
    setFormOpen(true);
  };

  const datesOk = dateRangeValid(form.fromDate, form.toDate);
  const canSubmit = form.studentId !== "" && datesOk && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const created = await portalApi.post<PortalLeaveRequest>("/student-leave/my", {
        studentId: form.studentId,
        type: form.type,
        fromDate: form.fromDate,
        toDate: form.toDate,
        reason: form.reason.trim() === "" ? undefined : form.reason.trim(),
      });
      setNotice(
        `Leave request submitted for ${created.studentName} (${formatDate(created.fromDate)} – ${formatDate(created.toDate)}) — pending review.`
      );
      setFormOpen(false);
      await load();
    } catch (err) {
      setFormError(errMsg(err, "Could not submit this leave request."));
    } finally {
      setSubmitting(false);
    }
  };

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      await portalApi.delete(`/student-leave/my/${cancelTarget.id}`);
      setNotice("Leave request cancelled.");
      setCancelTarget(null);
      await load();
    } catch (err) {
      setCancelError(errMsg(err, "Could not cancel this leave request."));
    } finally {
      setCancelBusy(false);
    }
  };

  if (isStudent) {
    return (
      <>
        <PageHeader title={t("portalPages.leave.title")} />
        <EmptyState message="Leave requests are filed and tracked by parent/guardian accounts. Please ask your parent or guardian to apply for leave." />
      </>
    );
  }

  if (loading) return <Spinner />;

  if (error) {
    return (
      <>
        <PageHeader title={t("portalPages.leave.title")} />
        <ErrorNote message={error} />
        <Button variant="secondary" onClick={load}>
          Try again
        </Button>
      </>
    );
  }

  if (kids.length === 0) {
    return (
      <>
        <PageHeader title={t("portalPages.leave.title")} />
        <EmptyState message="No student linked to your account yet." />
      </>
    );
  }

  const list = rows ?? [];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title={t("portalPages.leave.title")}
          subtitle="Apply for leave and track approval status"
        />
        <Button onClick={openForm}>New request</Button>
      </div>

      {notice && (
        <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </p>
      )}

      {list.length === 0 ? (
        <EmptyState message="No leave requests yet. Use “New request” to file one." />
      ) : (
        <div className="space-y-3">
          {list.map((row) => (
            <Card key={row.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-900">{row.studentName}</p>
                    <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                    <Badge tone="slate">{typeLabel(row.type)}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {formatDate(row.fromDate)} – {formatDate(row.toDate)} ·{" "}
                    {Number(row.days)} {Number(row.days) === 1 ? "day" : "days"}
                  </p>
                  {row.reason && (
                    <p className="mt-1 whitespace-pre-line text-sm text-slate-500">
                      {row.reason}
                    </p>
                  )}
                  {row.reviewNote && (
                    <p className="mt-1 text-sm text-slate-500">
                      <span className="font-medium text-slate-600">Reviewer note:</span>{" "}
                      {row.reviewNote}
                    </p>
                  )}
                  {row.status === "approved" && (
                    <p className="mt-1 text-xs text-emerald-700">
                      Attendance for these dates is marked as excused.
                    </p>
                  )}
                  <p className="mt-1 text-xs text-slate-400">
                    Requested {formatDate(row.createdAt)}
                  </p>
                </div>
                {canCancel(row, user?.id) && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setNotice(null);
                      setCancelError(null);
                      setCancelTarget(row);
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        title="New leave request"
        open={formOpen}
        onClose={() => (submitting ? undefined : setFormOpen(false))}
      >
        <div className="space-y-4">
          {kids.length > 1 ? (
            <Field label="Student">
              <Select
                value={form.studentId}
                onChange={(e) => setForm((f) => ({ ...f, studentId: e.target.value }))}
              >
                {kids.map((child) => (
                  <option key={child.id} value={child.id}>
                    {child.firstName} {child.lastName}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <p className="text-sm text-slate-600">
              For {kids[0]?.firstName} {kids[0]?.lastName}
            </p>
          )}
          <Field label="Type">
            <Select
              value={form.type}
              onChange={(e) =>
                setForm((f) => ({ ...f, type: e.target.value as PortalLeaveType }))
              }
            >
              {Object.entries(LEAVE_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From">
              <Input
                type="date"
                value={form.fromDate}
                onChange={(e) => setForm((f) => ({ ...f, fromDate: e.target.value }))}
              />
            </Field>
            <Field label="To">
              <Input
                type="date"
                value={form.toDate}
                onChange={(e) => setForm((f) => ({ ...f, toDate: e.target.value }))}
              />
            </Field>
          </div>
          {form.fromDate !== "" && form.toDate !== "" && !datesOk && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
              The start date must be on or before the end date.
            </p>
          )}
          <Field label="Reason (optional)">
            <Textarea
              rows={3}
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="A short note for the reviewer"
            />
          </Field>
          <p className="text-xs text-slate-500">
            If approved, the school marks these dates as excused in the
            attendance register.
          </p>
          <ErrorNote message={formError} />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setFormOpen(false)}
              disabled={submitting}
            >
              Close
            </Button>
            <Button onClick={submit} disabled={!canSubmit}>
              {submitting ? "Submitting…" : "Submit request"}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={cancelTarget !== null}
        title="Cancel this leave request?"
        message={
          <div className="space-y-2">
            {cancelTarget && (
              <p>
                {formatDate(cancelTarget.fromDate)} – {formatDate(cancelTarget.toDate)}{" "}
                for {cancelTarget.studentName}. The request will be withdrawn
                before review.
              </p>
            )}
            <ErrorNote message={cancelError} />
          </div>
        }
        confirmLabel="Cancel request"
        cancelLabel="Keep request"
        busy={cancelBusy}
        onConfirm={confirmCancel}
        onClose={() => (cancelBusy ? undefined : setCancelTarget(null))}
      />
    </>
  );
}
