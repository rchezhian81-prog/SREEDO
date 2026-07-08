"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { usePermissions } from "@/lib/use-permissions";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Spinner,
  Textarea,
} from "@/components/ui";
import type { StudentDues, TransferCertificate } from "@/types";
import { useTerms } from "@/lib/terms";

const STATUS_TONES: Record<
  TransferCertificate["status"],
  "slate" | "green" | "red"
> = {
  draft: "slate",
  issued: "green",
  cancelled: "red",
};

async function downloadPdf(path: string, filename: string) {
  const base =
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const d = await res.json();
      if (typeof d.error === "string") msg = d.error;
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(res.status, msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const today = () => new Date().toISOString().slice(0, 10);

function fmtDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div>
      <p className="text-xs uppercase text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-900">{value || "—"}</p>
    </div>
  );
}

export default function TransferCertificateDetailPage() {
  const term = useTerms();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { can, loading: permsLoading } = usePermissions();
  const canRead = can("transfer_certificates:read");
  const canUpdate = can("transfer_certificates:update");
  const canIssue = can("transfer_certificates:issue");
  const canCancel = can("transfer_certificates:cancel");
  const canDownload = can("transfer_certificates:download");

  const [tc, setTc] = useState<TransferCertificate | null>(null);
  const [dues, setDues] = useState<StudentDues | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Edit modal.
  const [editOpen, setEditOpen] = useState(false);
  const [editLeavingReason, setEditLeavingReason] = useState("");
  const [editConduct, setEditConduct] = useState("");
  const [editAcademicYear, setEditAcademicYear] = useState("");
  const [editLastAttendance, setEditLastAttendance] = useState("");
  const [editDateOfIssue, setEditDateOfIssue] = useState("");
  const [editRemarks, setEditRemarks] = useState("");

  // Issue modal.
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueDateOfIssue, setIssueDateOfIssue] = useState(today());
  const [issueLastAttendance, setIssueLastAttendance] = useState("");
  const [overrideDues, setOverrideDues] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  // Cancel modal.
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const cert = await api.get<TransferCertificate>(
        `/transfer-certificates/${id}`
      );
      setTc(cert);
      api
        .get<StudentDues>(
          `/transfer-certificates/student/${cert.studentId}/dues`
        )
        .then(setDues)
        .catch(() => setDues(null));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
      } else {
        setLoadError(
          err instanceof ApiError
            ? err.message
            : "Failed to load transfer certificate"
        );
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (permsLoading || !canRead) return;
    load();
  }, [load, permsLoading, canRead]);

  const openEdit = () => {
    if (!tc) return;
    setEditLeavingReason(tc.leavingReason ?? "");
    setEditConduct(tc.conduct ?? "");
    setEditAcademicYear(tc.academicYear ?? "");
    setEditLastAttendance(tc.lastAttendanceDate?.slice(0, 10) ?? "");
    setEditDateOfIssue(tc.dateOfIssue?.slice(0, 10) ?? "");
    setEditRemarks(tc.remarks ?? "");
    setActionError(null);
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!tc) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await api.patch(`/transfer-certificates/${tc.id}`, {
        leavingReason: editLeavingReason || undefined,
        conduct: editConduct || undefined,
        academicYear: editAcademicYear || undefined,
        lastAttendanceDate: editLastAttendance || undefined,
        dateOfIssue: editDateOfIssue || undefined,
        remarks: editRemarks || undefined,
      });
      setEditOpen(false);
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to update certificate"
      );
    } finally {
      setActionBusy(false);
    }
  };

  const openIssue = () => {
    if (!tc) return;
    setIssueDateOfIssue(tc.dateOfIssue?.slice(0, 10) ?? today());
    setIssueLastAttendance(tc.lastAttendanceDate?.slice(0, 10) ?? "");
    setOverrideDues(false);
    setOverrideReason("");
    setActionError(null);
    setIssueOpen(true);
  };

  const submitIssue = async () => {
    if (!tc) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await api.post(`/transfer-certificates/${tc.id}/issue`, {
        dateOfIssue: issueDateOfIssue || undefined,
        lastAttendanceDate: issueLastAttendance || undefined,
        overrideDues: overrideDues || undefined,
        overrideReason: overrideDues ? overrideReason || undefined : undefined,
      });
      setIssueOpen(false);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setActionError(
          "The student has pending dues. Tick “Override dues” and give a reason to issue anyway."
        );
        setOverrideDues(true);
      } else if (err instanceof ApiError && err.status === 403) {
        setActionError(
          "You don't have permission to override dues. Clear the dues first."
        );
      } else {
        setActionError(
          err instanceof ApiError ? err.message : "Failed to issue certificate"
        );
      }
    } finally {
      setActionBusy(false);
    }
  };

  const openCancel = () => {
    setCancelReason("");
    setActionError(null);
    setCancelOpen(true);
  };

  const submitCancel = async () => {
    if (!tc) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await api.post(`/transfer-certificates/${tc.id}/cancel`, {
        reason: cancelReason || undefined,
      });
      setCancelOpen(false);
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to cancel certificate"
      );
    } finally {
      setActionBusy(false);
    }
  };

  const download = async () => {
    if (!tc) return;
    setDownloadError(null);
    try {
      await downloadPdf(
        `/transfer-certificates/${tc.id}/download`,
        `${tc.tcNo}.pdf`
      );
    } catch (err) {
      setDownloadError(
        err instanceof ApiError ? err.message : "Failed to download PDF"
      );
    }
  };

  const back = (
    <Link
      href="/transfer-certificates"
      className="text-sm font-medium text-brand-600 hover:text-brand-700"
    >
      ← Back to register
    </Link>
  );

  if (permsLoading || loading) {
    return (
      <>
        <PageHeader title="Transfer Certificate" />
        <Spinner />
      </>
    );
  }

  if (!canRead) {
    return (
      <>
        <PageHeader title="Transfer Certificate" />
        <EmptyState message="You don't have permission to view this page." />
      </>
    );
  }

  if (notFound) {
    return (
      <>
        <PageHeader title="Transfer Certificate" />
        <div className="mb-4">{back}</div>
        <EmptyState message="Transfer certificate not found." />
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <PageHeader title="Transfer Certificate" />
        <div className="mb-4">{back}</div>
        <ErrorNote message={loadError} />
      </>
    );
  }

  if (!tc) return null;

  const isDraft = tc.status === "draft";
  const isCancelled = tc.status === "cancelled";
  const duesPending = dues?.hasDues ?? false;

  return (
    <>
      <PageHeader
        title={`TC ${tc.tcNo}`}
        subtitle={tc.studentName}
        action={<Badge tone={STATUS_TONES[tc.status]}>{tc.status}</Badge>}
      />

      <div className="mb-4">{back}</div>

      <div className="mb-4 flex flex-wrap gap-2">
        {isDraft && canUpdate && (
          <Button variant="secondary" onClick={openEdit}>
            Edit
          </Button>
        )}
        {isDraft && canIssue && (
          <Button onClick={openIssue}>Issue</Button>
        )}
        {!isCancelled && canCancel && (
          <Button variant="danger" onClick={openCancel}>
            Cancel
          </Button>
        )}
        {canDownload && (
          <Button variant="secondary" onClick={download}>
            Download PDF
          </Button>
        )}
      </div>

      <ErrorNote message={downloadError} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <DetailRow label="TC No" value={tc.tcNo} />
            <DetailRow label="Student" value={tc.studentName} />
            <DetailRow label={term.admissionNo} value={tc.admissionNo} />
            <DetailRow
              label={`${term.klass} / ${term.section}`}
              value={
                tc.className
                  ? `${tc.className}${
                      tc.sectionName ? ` — ${tc.sectionName}` : ""
                    }`
                  : null
              }
            />
            <DetailRow label="Program" value={tc.programName} />
            <DetailRow label="Semester" value={tc.semesterName} />
            <DetailRow label="Academic year" value={tc.academicYear} />
            <DetailRow label="Date of issue" value={fmtDate(tc.dateOfIssue)} />
            <DetailRow
              label="Last attendance"
              value={fmtDate(tc.lastAttendanceDate)}
            />
            <DetailRow label="Leaving reason" value={tc.leavingReason} />
            <DetailRow label="Conduct" value={tc.conduct} />
            <DetailRow label="Remarks" value={tc.remarks} />
            <DetailRow label="Fee dues" value={tc.feeDuesStatus} />
            <DetailRow label="Library dues" value={tc.libraryDuesStatus} />
            <DetailRow label="Transport dues" value={tc.transportDuesStatus} />
            <DetailRow label="Hostel dues" value={tc.hostelDuesStatus} />
            {tc.duesOverride && (
              <DetailRow
                label="Dues override reason"
                value={tc.duesOverrideReason}
              />
            )}
            <DetailRow label="Issued at" value={fmtDate(tc.issuedAt)} />
            {isCancelled && (
              <>
                <DetailRow label="Cancelled at" value={fmtDate(tc.cancelledAt)} />
                <DetailRow label="Cancel reason" value={tc.cancelReason} />
              </>
            )}
          </div>
        </Card>

        <Card>
          <h3 className="text-sm font-semibold text-slate-900">Student dues</h3>
          {dues ? (
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Fees</span>
                <span className="text-slate-900">
                  {Number(dues.fee.amount).toLocaleString()}
                  <span className="ml-1 text-xs text-slate-400">
                    ({dues.fee.count})
                  </span>
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Transport</span>
                <span className="text-slate-900">
                  {Number(dues.transport.amount).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Hostel</span>
                <span className="text-slate-900">
                  {Number(dues.hostel.amount).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Library books</span>
                <span className="text-slate-900">{dues.library.books}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Library fines</span>
                <span className="text-slate-900">
                  {Number(dues.library.fines).toLocaleString()}
                </span>
              </div>
              <div className="mt-3 border-t border-slate-100 pt-3">
                <Badge tone={dues.hasDues ? "red" : "green"}>
                  {dues.hasDues ? "Pending dues" : "No dues"}
                </Badge>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-400">Dues unavailable</p>
          )}
        </Card>
      </div>

      {/* Edit modal */}
      <Modal title="Edit certificate" open={editOpen} onClose={() => setEditOpen(false)}>
        <div className="space-y-4">
          <Field label="Leaving reason">
            <Input
              value={editLeavingReason}
              onChange={(event) => setEditLeavingReason(event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Conduct">
              <Input
                value={editConduct}
                onChange={(event) => setEditConduct(event.target.value)}
              />
            </Field>
            <Field label="Academic year">
              <Input
                value={editAcademicYear}
                onChange={(event) => setEditAcademicYear(event.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Last attendance date">
              <Input
                type="date"
                value={editLastAttendance}
                onChange={(event) => setEditLastAttendance(event.target.value)}
              />
            </Field>
            <Field label="Date of issue">
              <Input
                type="date"
                value={editDateOfIssue}
                onChange={(event) => setEditDateOfIssue(event.target.value)}
              />
            </Field>
          </div>
          <Field label="Remarks">
            <Textarea
              rows={3}
              value={editRemarks}
              onChange={(event) => setEditRemarks(event.target.value)}
            />
          </Field>
          <ErrorNote message={actionError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={saveEdit} disabled={actionBusy}>
              {actionBusy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Issue modal */}
      <Modal title="Issue certificate" open={issueOpen} onClose={() => setIssueOpen(false)}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date of issue">
              <Input
                type="date"
                value={issueDateOfIssue}
                onChange={(event) => setIssueDateOfIssue(event.target.value)}
              />
            </Field>
            <Field label="Last attendance date">
              <Input
                type="date"
                value={issueLastAttendance}
                onChange={(event) => setIssueLastAttendance(event.target.value)}
              />
            </Field>
          </div>

          {duesPending && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm text-amber-800">
                This student has pending dues.
              </p>
              <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={overrideDues}
                  onChange={(event) => setOverrideDues(event.target.checked)}
                  className="rounded border-slate-300"
                />
                Override dues and issue anyway
              </label>
              {overrideDues && (
                <div className="mt-3">
                  <Field label="Override reason">
                    <Input
                      value={overrideReason}
                      onChange={(event) =>
                        setOverrideReason(event.target.value)
                      }
                      placeholder="Reason for overriding dues"
                    />
                  </Field>
                </div>
              )}
            </div>
          )}

          <ErrorNote message={actionError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIssueOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={submitIssue}
              disabled={
                actionBusy ||
                (duesPending && overrideDues && !overrideReason.trim())
              }
            >
              {actionBusy ? "Issuing…" : "Issue certificate"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Cancel modal */}
      <Modal title="Cancel certificate" open={cancelOpen} onClose={() => setCancelOpen(false)}>
        <div className="space-y-4">
          <Field label="Reason">
            <Textarea
              rows={3}
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="Why is this certificate being cancelled?"
            />
          </Field>
          <ErrorNote message={actionError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCancelOpen(false)}
            >
              Back
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={submitCancel}
              disabled={actionBusy}
            >
              {actionBusy ? "Cancelling…" : "Cancel certificate"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
