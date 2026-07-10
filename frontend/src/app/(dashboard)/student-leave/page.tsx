"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Badge, Button, ConfirmDialog, EmptyState, ErrorNote, Field, Input,
  Modal, PageHeader, Select, Spinner,
} from "@/components/ui";
import type { Paginated } from "@/types";

// PR-T9 — Student Leave (staff). File requests on behalf, and approve/reject —
// approval marks the student 'excused' in daily attendance. The guardian-scoped
// parent application API (/student-leave/my) will surface in the /portal (PR-T9.1).

const TYPES = ["sick", "casual", "emergency", "other"] as const;
const STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
const TONE: Record<string, "slate" | "green" | "amber" | "red" | "blue"> = {
  pending: "amber", approved: "green", rejected: "red", cancelled: "slate",
};
const textareaCls =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand-500";

interface Leave {
  id: string; studentId: string; studentName: string; admissionNo: string | null;
  type: string; fromDate: string; toDate: string; days: number; reason: string | null;
  status: string; reviewNote: string | null;
}

export default function StudentLeavePage() {
  const { can, loading: permLoading } = usePermissions();
  const canRead = can("student_leave:read");
  const canApprove = can("student_leave:approve");
  const canCreate = can("student_leave:create");
  const [rows, setRows] = useState<Leave[]>([]);
  const [statusF, setStatusF] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<string | null>(null);
  const [fileOpen, setFileOpen] = useState(false);
  const [review, setReview] = useState<Leave | null>(null);
  const [toCancel, setToCancel] = useState<Leave | null>(null);
  const [students, setStudents] = useState<{ id: string; firstName: string; lastName: string; admissionNo: string }[]>([]);

  const load = useCallback(async () => {
    setLoading(true); setRowErr(null);
    try {
      const p = new URLSearchParams({ limit: "50" });
      if (statusF) p.set("status", statusF);
      const r = await api.get<Paginated<Leave>>(`/student-leave?${p.toString()}`);
      setRows(r.data);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, [statusF]);
  // Depend on the stable boolean, not the `can` function (which changes identity
  // every render and would re-fire this effect in a loop).
  useEffect(() => { if (canRead) load(); }, [load, canRead]);
  useEffect(() => {
    api.get<Paginated<typeof students[number]>>("/students?limit=200").then((r) => setStudents(r.data)).catch(() => undefined);
  }, []);

  const cancel = async () => {
    if (!toCancel) return;
    setRowErr(null);
    try { await api.delete(`/student-leave/${toCancel.id}`); setToCancel(null); await load(); }
    catch (e) { setRowErr(e instanceof ApiError ? e.message : "Failed to cancel"); }
  };

  if (permLoading) return <Spinner />;
  if (!canRead) {
    return (
      <>
        <PageHeader title="Student Leave" subtitle="File and review student leave requests" />
        <EmptyState message="You don't have access to student leave." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Student Leave"
        subtitle="File leave on behalf of students and approve or reject requests"
        action={canCreate ? <Button onClick={() => setFileOpen(true)}>+ File leave</Button> : undefined}
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-48">
          <Select value={statusF} onChange={(e) => setStatusF(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
      </div>
      <ErrorNote message={error ?? rowErr} />
      {loading ? <Spinner /> : rows.length === 0 ? <EmptyState message="No leave requests" /> : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr><th className="px-4 py-3">Student</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Dates</th><th className="px-4 py-3">Days</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((l) => (
                <tr key={l.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3"><span className="font-medium text-ink">{l.studentName}</span>{l.admissionNo && <span className="block text-xs text-faint">{l.admissionNo}</span>}</td>
                  <td className="px-4 py-3 capitalize text-muted">{l.type}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{l.fromDate} → {l.toDate}</td>
                  <td className="px-4 py-3 text-muted">{l.days}</td>
                  <td className="px-4 py-3"><Badge tone={TONE[l.status]}>{l.status}</Badge></td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-3">
                      {canApprove && l.status === "pending" && (
                        <button onClick={() => setReview(l)} className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300">Review</button>
                      )}
                      {canApprove && (l.status === "pending" || l.status === "approved") && (
                        <button onClick={() => setToCancel(l)} className="text-xs font-medium text-red-600 hover:text-red-700">Cancel</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {fileOpen && (
        <FileLeaveModal students={students} onClose={() => setFileOpen(false)} onSaved={() => { setFileOpen(false); load(); }} />
      )}
      {review && (
        <ReviewModal leave={review} onClose={() => setReview(null)} onDone={() => { setReview(null); load(); }} />
      )}
      <ConfirmDialog
        open={toCancel !== null}
        title="Cancel leave"
        message={toCancel?.status === "approved" ? "Cancel this approved leave? The excused attendance marks it created will be removed." : "Cancel this leave request?"}
        onConfirm={cancel}
        onClose={() => setToCancel(null)}
      />
    </>
  );
}

function FileLeaveModal({ students, onClose, onSaved }: {
  students: { id: string; firstName: string; lastName: string; admissionNo: string }[];
  onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({ studentId: "", type: "sick", fromDate: "", toDate: "", reason: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setSaving(true); setErr(null);
    const body: Record<string, unknown> = { studentId: f.studentId, type: f.type, fromDate: f.fromDate, toDate: f.toDate };
    if (f.reason) body.reason = f.reason;
    try { await api.post("/student-leave", body); onSaved(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Failed to file leave"); }
    finally { setSaving(false); }
  };
  return (
    <Modal title="File student leave" open onClose={onClose}>
      <div className="space-y-4">
        <Field label="Student">
          <Select value={f.studentId} onChange={(e) => setF({ ...f, studentId: e.target.value })}>
            <option value="">Select a student…</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName} ({s.admissionNo})</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
          <div />
          <Field label="From"><Input type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} /></Field>
          <Field label="To"><Input type="date" value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} /></Field>
        </div>
        <Field label="Reason"><textarea rows={2} className={textareaCls} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        <ErrorNote message={err} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !f.studentId || !f.fromDate || !f.toDate}>{saving ? "Saving…" : "File"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function ReviewModal({ leave, onClose, onDone }: { leave: Leave; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const act = async (kind: "approve" | "reject") => {
    setBusy(true); setErr(null);
    try { await api.post(`/student-leave/${leave.id}/${kind}`, { reviewNote: note || undefined }); onDone(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Action failed"); setBusy(false); }
  };
  return (
    <Modal title={`Review — ${leave.studentName}`} open onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-lg border border-line bg-surface-2 p-3 text-sm text-muted">
          <div className="capitalize">{leave.type} leave · {leave.fromDate} → {leave.toDate} ({leave.days} day{leave.days === 1 ? "" : "s"})</div>
          {leave.reason && <div className="mt-1">Reason: {leave.reason}</div>}
          <div className="mt-1 text-xs text-faint">Approving marks the student excused for these dates.</div>
        </div>
        <Field label="Review note (optional)"><textarea rows={2} className={textareaCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <ErrorNote message={err} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Close</Button>
          <Button variant="danger" onClick={() => act("reject")} disabled={busy}>Reject</Button>
          <Button onClick={() => act("approve")} disabled={busy}>{busy ? "Working…" : "Approve"}</Button>
        </div>
      </div>
    </Modal>
  );
}
