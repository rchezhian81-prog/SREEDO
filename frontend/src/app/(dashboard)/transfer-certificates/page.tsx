"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
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
} from "@/components/ui";
import type {
  Paginated,
  Student,
  StudentDues,
  TransferCertificate,
} from "@/types";
import { useTerms } from "@/lib/terms";

const STATUS_TONES: Record<
  TransferCertificate["status"],
  "slate" | "green" | "red"
> = {
  draft: "slate",
  issued: "green",
  cancelled: "red",
};

function duesSummary(dues: StudentDues): string {
  if (!dues.hasDues) return "No dues";
  const parts: string[] = [];
  if (Number(dues.fee.amount) > 0) {
    parts.push(`Pending fees: ${Number(dues.fee.amount).toLocaleString()}`);
  }
  if (Number(dues.transport.amount) > 0) {
    parts.push(`Transport: ${Number(dues.transport.amount).toLocaleString()}`);
  }
  if (Number(dues.hostel.amount) > 0) {
    parts.push(`Hostel: ${Number(dues.hostel.amount).toLocaleString()}`);
  }
  if (dues.library.books > 0) {
    parts.push(`Library books: ${dues.library.books}`);
  }
  if (Number(dues.library.fines) > 0) {
    parts.push(`Library fines: ${Number(dues.library.fines).toLocaleString()}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Pending dues";
}

export default function TransferCertificatesPage() {
  const term = useTerms();
  const router = useRouter();
  const { can, loading: permsLoading } = usePermissions();
  const canRead = can("transfer_certificates:read");
  const canCreate = can("transfer_certificates:create");

  const [certificates, setCertificates] = useState<TransferCertificate[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // New TC modal state.
  const [modalOpen, setModalOpen] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  const [studentResults, setStudentResults] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [dues, setDues] = useState<StudentDues | null>(null);
  const [duesLoading, setDuesLoading] = useState(false);
  const [leavingReason, setLeavingReason] = useState("");
  const [conduct, setConduct] = useState("");
  const [academicYear, setAcademicYear] = useState("");
  const [lastAttendanceDate, setLastAttendanceDate] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (search) params.set("search", search);
      const qs = params.toString();
      setCertificates(
        await api.get<TransferCertificate[]>(
          `/transfer-certificates${qs ? `?${qs}` : ""}`
        )
      );
    } catch (err) {
      setLoadError(
        err instanceof ApiError
          ? err.message
          : "Failed to load transfer certificates"
      );
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    if (permsLoading || !canRead) return;
    load();
  }, [load, permsLoading, canRead]);

  // Debounced student search inside the modal.
  useEffect(() => {
    if (!modalOpen) return;
    const handle = setTimeout(() => {
      const params = new URLSearchParams({ limit: "10" });
      if (studentSearch) params.set("search", studentSearch);
      api
        .get<Paginated<Student>>(`/students?${params.toString()}`)
        .then((res) => setStudentResults(res.data))
        .catch(() => setStudentResults([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [modalOpen, studentSearch]);

  const resetModal = useCallback(() => {
    setStudentSearch("");
    setStudentResults([]);
    setSelectedStudent(null);
    setDues(null);
    setDuesLoading(false);
    setLeavingReason("");
    setConduct("");
    setAcademicYear("");
    setLastAttendanceDate("");
    setCreateError(null);
  }, []);

  const openModal = () => {
    resetModal();
    setModalOpen(true);
  };

  const pickStudent = async (student: Student) => {
    setSelectedStudent(student);
    setDues(null);
    setDuesLoading(true);
    try {
      setDues(
        await api.get<StudentDues>(
          `/transfer-certificates/student/${student.id}/dues`
        )
      );
    } catch {
      setDues(null);
    } finally {
      setDuesLoading(false);
    }
  };

  const createCertificate = async () => {
    if (!selectedStudent) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await api.post<TransferCertificate>(
        "/transfer-certificates",
        {
          studentId: selectedStudent.id,
          leavingReason: leavingReason || undefined,
          conduct: conduct || undefined,
          academicYear: academicYear || undefined,
          lastAttendanceDate: lastAttendanceDate || undefined,
        }
      );
      setModalOpen(false);
      resetModal();
      await load();
      router.push(`/transfer-certificates/${created.id}`);
    } catch (err) {
      setCreateError(
        err instanceof ApiError
          ? err.message
          : "Failed to create transfer certificate"
      );
    } finally {
      setCreating(false);
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Transfer Certificates" />
        <Spinner />
      </>
    );
  }

  if (!canRead) {
    return (
      <>
        <PageHeader title="Transfer Certificates" />
        <EmptyState message="You don't have permission to view this page." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Transfer Certificates"
        subtitle="Issue and track student leaving certificates"
        action={
          canCreate ? (
            <Button onClick={openModal}>+ New TC</Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-48">
          <Select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="issued">Issued</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </div>
        <div className="max-w-xs flex-1">
          <Input
            placeholder="Search by TC no, student or admission no…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      {loadError ? (
        <ErrorNote message={loadError} />
      ) : loading ? (
        <Spinner />
      ) : certificates.length === 0 ? (
        <EmptyState message="No transfer certificates found" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">TC No</th>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">{term.admissionNo}</th>
                <th className="px-4 py-3">Class/Section</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Issue Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {certificates.map((tc) => (
                <tr key={tc.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link
                      href={`/transfer-certificates/${tc.id}`}
                      className="font-medium text-brand-600 hover:text-brand-700"
                    >
                      {tc.tcNo}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {tc.studentName}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {tc.admissionNo}
                  </td>
                  <td className="px-4 py-3">
                    {tc.className
                      ? `${tc.className}${
                          tc.sectionName ? ` — ${tc.sectionName}` : ""
                        }`
                      : tc.programName
                      ? `${tc.programName}${
                          tc.semesterName ? ` — ${tc.semesterName}` : ""
                        }`
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONES[tc.status]}>{tc.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {tc.dateOfIssue
                      ? new Date(tc.dateOfIssue).toLocaleDateString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        title="New transfer certificate"
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <div className="space-y-4">
          {selectedStudent ? (
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {selectedStudent.firstName} {selectedStudent.lastName}
                  </p>
                  <p className="font-mono text-xs text-slate-500">
                    {selectedStudent.admissionNo}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setSelectedStudent(null);
                    setDues(null);
                  }}
                  className="text-xs font-medium text-brand-600 hover:text-brand-700"
                >
                  Change
                </button>
              </div>
              <p className="mt-2 text-xs">
                {duesLoading ? (
                  <span className="text-slate-400">Checking dues…</span>
                ) : dues ? (
                  <span
                    className={
                      dues.hasDues
                        ? "font-medium text-red-600"
                        : "font-medium text-emerald-600"
                    }
                  >
                    {duesSummary(dues)}
                  </span>
                ) : (
                  <span className="text-slate-400">Dues unavailable</span>
                )}
              </p>
            </div>
          ) : (
            <Field label="Student">
              <Input
                placeholder="Search by name or admission no…"
                value={studentSearch}
                onChange={(event) => setStudentSearch(event.target.value)}
              />
              <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-slate-200">
                {studentResults.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate-400">
                    No students found
                  </p>
                ) : (
                  studentResults.map((student) => (
                    <button
                      key={student.id}
                      type="button"
                      onClick={() => pickStudent(student)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                    >
                      <span className="text-slate-900">
                        {student.firstName} {student.lastName}
                      </span>
                      <span className="font-mono text-xs text-slate-400">
                        {student.admissionNo}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </Field>
          )}

          <Field label="Leaving reason">
            <Input
              placeholder="e.g. Relocation"
              value={leavingReason}
              onChange={(event) => setLeavingReason(event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Conduct">
              <Input
                placeholder="e.g. Good"
                value={conduct}
                onChange={(event) => setConduct(event.target.value)}
              />
            </Field>
            <Field label="Academic year">
              <Input
                placeholder="e.g. 2025-2026"
                value={academicYear}
                onChange={(event) => setAcademicYear(event.target.value)}
              />
            </Field>
          </div>
          <Field label="Last attendance date">
            <Input
              type="date"
              value={lastAttendanceDate}
              onChange={(event) => setLastAttendanceDate(event.target.value)}
            />
          </Field>

          <ErrorNote message={createError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={createCertificate}
              disabled={!selectedStudent || creating}
            >
              {creating ? "Creating…" : "Create draft"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
