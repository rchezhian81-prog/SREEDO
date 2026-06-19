"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import type {
  DisciplinaryAction,
  DisciplinaryRecord,
  DisciplinarySeverity,
  DisciplinaryStatus,
} from "@/types";

const STATUS_LABELS: Record<DisciplinaryStatus, string> = {
  open: "Open",
  under_review: "Under review",
  action_taken: "Action taken",
  closed: "Closed",
  cancelled: "Cancelled",
};

function severityTone(
  severity: DisciplinarySeverity
): "red" | "amber" | "slate" {
  if (severity === "critical" || severity === "high") return "red";
  if (severity === "medium") return "amber";
  return "slate";
}

function statusTone(
  status: DisciplinaryStatus
): "slate" | "green" | "amber" | "red" | "blue" {
  switch (status) {
    case "open":
      return "blue";
    case "under_review":
      return "amber";
    case "action_taken":
      return "green";
    case "closed":
      return "slate";
    case "cancelled":
      return "red";
    default:
      return "slate";
  }
}

const editSchema = z.object({
  incidentDate: z.string().min(1, "Required"),
  category: z.string().min(1, "Required"),
  severity: z.enum(["low", "medium", "high", "critical"]),
  description: z.string().optional(),
  reportedBy: z.string().optional(),
  involvedStaff: z.string().optional(),
  followUpDate: z.string().optional(),
  remarks: z.string().optional(),
});

type EditForm = z.infer<typeof editSchema>;

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-0.5 text-sm text-slate-900">{value || "—"}</p>
    </div>
  );
}

export default function DisciplinaryDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { can, loading: permsLoading } = usePermissions();
  const canRead = can("disciplinary:read");
  const canUpdate = can("disciplinary:update");
  const canAction = can("disciplinary:action");
  const canClose = can("disciplinary:close");
  const canDelete = can("disciplinary:delete");

  const [record, setRecord] = useState<DisciplinaryRecord | null>(null);
  const [actions, setActions] = useState<DisciplinaryAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState(false);
  const [showActionForm, setShowActionForm] = useState(false);
  const [actionTaken, setActionTaken] = useState("");
  const [actionFollowUp, setActionFollowUp] = useState("");
  const [actionNote, setActionNote] = useState("");

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EditForm>({ resolver: zodResolver(editSchema) });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const detail = await api.get<DisciplinaryRecord>(`/disciplinary/${id}`);
      setRecord(detail);
      try {
        setActions(
          await api.get<DisciplinaryAction[]>(`/disciplinary/${id}/actions`)
        );
      } catch {
        setActions([]);
      }
    } catch (err) {
      setRecord(null);
      if (err instanceof ApiError && err.status === 404) {
        setLoadError("This disciplinary record could not be found.");
      } else {
        setLoadError(
          err instanceof ApiError ? err.message : "Failed to load record"
        );
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!permsLoading && canRead) load();
    else if (!permsLoading) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permsLoading, canRead, id]);

  const isLocked =
    record?.status === "closed" || record?.status === "cancelled";

  const startEdit = () => {
    if (!record) return;
    reset({
      incidentDate: record.incidentDate ?? "",
      category: record.category ?? "",
      severity: record.severity,
      description: record.description ?? "",
      reportedBy: record.reportedBy ?? "",
      involvedStaff: record.involvedStaff ?? "",
      followUpDate: record.followUpDate ?? "",
      remarks: record.remarks ?? "",
    });
    setActionError(null);
    setEditing(true);
  };

  const onSaveEdit = async (values: EditForm) => {
    setActionError(null);
    try {
      await api.patch(`/disciplinary/${id}`, {
        incidentDate: values.incidentDate,
        category: values.category,
        severity: values.severity,
        description: values.description || undefined,
        reportedBy: values.reportedBy || undefined,
        involvedStaff: values.involvedStaff || undefined,
        followUpDate: values.followUpDate || undefined,
        remarks: values.remarks || undefined,
      });
      setEditing(false);
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to save changes"
      );
    }
  };

  const runAction = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Action failed"
      );
    } finally {
      setBusy(false);
    }
  };

  const onReview = () =>
    runAction(() => api.post(`/disciplinary/${id}/review`, {}));

  const onRecordAction = async () => {
    if (!actionTaken.trim()) {
      setActionError("Describe the action taken.");
      return;
    }
    await runAction(() =>
      api.post(`/disciplinary/${id}/action`, {
        actionTaken: actionTaken.trim(),
        followUpDate: actionFollowUp || undefined,
        note: actionNote || undefined,
      })
    );
    setShowActionForm(false);
    setActionTaken("");
    setActionFollowUp("");
    setActionNote("");
  };

  const onClose = () => {
    if (!confirm("Close this disciplinary record?")) return;
    runAction(() => api.post(`/disciplinary/${id}/close`, {}));
  };

  const onCancel = () => {
    const reason = prompt("Reason for cancelling this record?");
    if (reason === null) return;
    runAction(() =>
      api.post(`/disciplinary/${id}/cancel`, { reason: reason || undefined })
    );
  };

  const onDelete = async () => {
    if (!confirm("Delete this disciplinary record? This cannot be undone."))
      return;
    setActionError(null);
    setBusy(true);
    try {
      await api.delete(`/disciplinary/${id}`);
      router.push("/disciplinary");
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to delete record"
      );
      setBusy(false);
    }
  };

  if (permsLoading || loading) {
    return (
      <>
        <PageHeader title="Incident" subtitle="Disciplinary record" />
        <Spinner />
      </>
    );
  }

  if (!canRead) {
    return (
      <>
        <PageHeader title="Incident" subtitle="Disciplinary record" />
        <EmptyState message="You don't have access to disciplinary records." />
      </>
    );
  }

  if (loadError || !record) {
    return (
      <>
        <PageHeader title="Incident" subtitle="Disciplinary record" />
        <div className="mb-4">
          <Link
            href="/disciplinary"
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            ← Back to Disciplinary
          </Link>
        </div>
        <ErrorNote message={loadError ?? "Record not found."} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={record.studentName}
        subtitle={`${record.admissionNo} · ${record.incidentDate}`}
        action={
          canUpdate && !isLocked && !editing ? (
            <Button variant="secondary" onClick={startEdit}>
              Edit
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Link
          href="/disciplinary"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Disciplinary
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(record.status)}>
          {STATUS_LABELS[record.status]}
        </Badge>
        <Badge tone={severityTone(record.severity)}>{record.severity}</Badge>
        {isLocked && (
          <span className="text-xs text-slate-500">
            This record is {STATUS_LABELS[record.status].toLowerCase()} and can
            no longer be modified.
          </span>
        )}
      </div>

      <ErrorNote message={actionError} />

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {editing ? (
            <Card>
              <h2 className="mb-4 text-lg font-semibold text-slate-900">
                Edit record
              </h2>
              <form
                onSubmit={handleSubmit(onSaveEdit)}
                className="space-y-4"
              >
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Incident date"
                    error={errors.incidentDate?.message}
                  >
                    <Input type="date" {...register("incidentDate")} />
                  </Field>
                  <Field label="Severity" error={errors.severity?.message}>
                    <Select {...register("severity")}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </Select>
                  </Field>
                </div>
                <Field label="Category" error={errors.category?.message}>
                  <Input {...register("category")} />
                </Field>
                <Field label="Description">
                  <Textarea rows={3} {...register("description")} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Reported by">
                    <Input {...register("reportedBy")} />
                  </Field>
                  <Field label="Involved staff">
                    <Input {...register("involvedStaff")} />
                  </Field>
                </div>
                <Field label="Follow-up date">
                  <Input type="date" {...register("followUpDate")} />
                </Field>
                <Field label="Remarks">
                  <Textarea rows={2} {...register("remarks")} />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              </form>
            </Card>
          ) : (
            <Card>
              <h2 className="mb-4 text-lg font-semibold text-slate-900">
                Incident details
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Detail label="Incident date" value={record.incidentDate} />
                <Detail label="Category" value={record.category} />
                <Detail
                  label="Class / Section"
                  value={
                    record.className
                      ? `${record.className}${
                          record.sectionName
                            ? ` — ${record.sectionName}`
                            : ""
                        }`
                      : null
                  }
                />
                <Detail
                  label="Program / Semester"
                  value={
                    record.programName
                      ? `${record.programName}${
                          record.semesterName
                            ? ` — ${record.semesterName}`
                            : ""
                        }`
                      : null
                  }
                />
                <Detail label="Reported by" value={record.reportedBy} />
                <Detail label="Involved staff" value={record.involvedStaff} />
                <Detail label="Follow-up date" value={record.followUpDate} />
                <Detail
                  label="Created"
                  value={new Date(record.createdAt).toLocaleString()}
                />
              </div>
              <div className="mt-4 space-y-4">
                <Detail label="Description" value={record.description} />
                <Detail label="Action taken" value={record.actionTaken} />
                <Detail label="Remarks" value={record.remarks} />
                {record.status === "cancelled" && (
                  <Detail
                    label="Cancellation reason"
                    value={record.cancelReason}
                  />
                )}
              </div>
            </Card>
          )}

          <Card>
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              Activity timeline
            </h2>
            {actions.length === 0 ? (
              <EmptyState message="No activity recorded yet." />
            ) : (
              <ol className="space-y-4">
                {actions.map((entry) => (
                  <li key={entry.id} className="flex gap-3">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {entry.action.replace(/_/g, " ")}
                        {entry.fromStatus && entry.toStatus ? (
                          <span className="font-normal text-slate-500">
                            {" "}
                            ({STATUS_LABELS[entry.fromStatus]} →{" "}
                            {STATUS_LABELS[entry.toStatus]})
                          </span>
                        ) : null}
                      </p>
                      {entry.note && (
                        <p className="text-sm text-slate-600">{entry.note}</p>
                      )}
                      <p className="text-xs text-slate-400">
                        {entry.byName ? `${entry.byName} · ` : ""}
                        {new Date(entry.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              Workflow
            </h2>
            {isLocked ? (
              <p className="text-sm text-slate-500">
                No further actions are available for a{" "}
                {STATUS_LABELS[record.status].toLowerCase()} record.
              </p>
            ) : (
              <div className="space-y-3">
                {canAction && record.status === "open" && (
                  <Button
                    className="w-full"
                    variant="secondary"
                    disabled={busy}
                    onClick={onReview}
                  >
                    Mark under review
                  </Button>
                )}

                {canAction && (
                  <div>
                    <Button
                      className="w-full"
                      disabled={busy}
                      onClick={() => setShowActionForm((v) => !v)}
                    >
                      Record action
                    </Button>
                    {showActionForm && (
                      <div className="mt-3 space-y-3 rounded-lg border border-slate-200 p-3">
                        <Field label="Action taken">
                          <Textarea
                            rows={2}
                            value={actionTaken}
                            onChange={(e) => setActionTaken(e.target.value)}
                          />
                        </Field>
                        <Field label="Follow-up date">
                          <Input
                            type="date"
                            value={actionFollowUp}
                            onChange={(e) =>
                              setActionFollowUp(e.target.value)
                            }
                          />
                        </Field>
                        <Field label="Note">
                          <Textarea
                            rows={2}
                            value={actionNote}
                            onChange={(e) => setActionNote(e.target.value)}
                          />
                        </Field>
                        <Button
                          className="w-full"
                          disabled={busy}
                          onClick={onRecordAction}
                        >
                          {busy ? "Saving…" : "Save action"}
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {canClose && (
                  <Button
                    className="w-full"
                    variant="secondary"
                    disabled={busy}
                    onClick={onClose}
                  >
                    Close
                  </Button>
                )}

                {canDelete && (
                  <Button
                    className="w-full"
                    variant="secondary"
                    disabled={busy}
                    onClick={onCancel}
                  >
                    Cancel record
                  </Button>
                )}
              </div>
            )}

            {canDelete && (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <Button
                  className="w-full"
                  variant="danger"
                  disabled={busy}
                  onClick={onDelete}
                >
                  Delete
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
