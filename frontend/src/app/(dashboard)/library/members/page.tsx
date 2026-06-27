"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
  LibraryHistoryRow,
  LibraryMember,
  Paginated,
  Student,
  Teacher,
} from "@/types";

const MEMBER_STATUSES = ["active", "suspended", "inactive"];

function memberStatusTone(status: string): "green" | "amber" | "slate" | "red" {
  if (status === "active") return "green";
  if (status === "suspended") return "amber";
  if (status === "inactive") return "slate";
  return "slate";
}

const registerSchema = z
  .object({
    memberType: z.enum(["student", "staff"]),
    studentId: z.string().optional(),
    teacherId: z.string().optional(),
    memberCode: z.string().optional(),
  })
  .refine(
    (value) =>
      value.memberType === "student" ? !!value.studentId : !!value.teacherId,
    { message: "Select a person", path: ["studentId"] }
  );

type RegisterForm = z.infer<typeof registerSchema>;

const editSchema = z.object({
  status: z.string().optional(),
  memberCode: z.string().optional(),
});

type EditForm = z.infer<typeof editSchema>;

function fmtDate(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

export default function LibraryMembersPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canCreate = can("library:create");
  const canUpdate = can("library:update");
  const canDelete = can("library:delete");

  const [members, setMembers] = useState<LibraryMember[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);

  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  const [editing, setEditing] = useState<LibraryMember | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  // History panel.
  const [historyMember, setHistoryMember] = useState<LibraryMember | null>(null);
  const [history, setHistory] = useState<LibraryHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (typeFilter) params.set("memberType", typeFilter);
      if (search) params.set("search", search);
      const qs = params.toString();
      setMembers(
        await api.get<LibraryMember[]>(`/library/members${qs ? `?${qs}` : ""}`)
      );
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load members"
      );
    } finally {
      setLoading(false);
    }
  }, [typeFilter, search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .get<Paginated<Student>>("/students?limit=500")
      .then((result) => setStudents(result.data))
      .catch(() => undefined);
    api
      .get<Paginated<Teacher>>("/teachers?limit=500")
      .then((result) => setTeachers(result.data))
      .catch(() => undefined);
  }, []);

  // --- Register ---
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({ resolver: zodResolver(registerSchema) });

  const memberType = watch("memberType");

  const openRegister = () => {
    setRegisterError(null);
    reset({
      memberType: "student",
      studentId: "",
      teacherId: "",
      memberCode: "",
    });
    setRegisterOpen(true);
  };

  const onRegister = async (values: RegisterForm) => {
    setRegisterError(null);
    try {
      await api.post("/library/members", {
        memberType: values.memberType,
        studentId:
          values.memberType === "student" ? values.studentId : undefined,
        teacherId: values.memberType === "staff" ? values.teacherId : undefined,
        memberCode: values.memberCode || undefined,
      });
      setRegisterOpen(false);
      reset();
      await load();
    } catch (err) {
      setRegisterError(
        err instanceof ApiError ? err.message : "Failed to register member"
      );
    }
  };

  // --- Edit ---
  const {
    register: registerEdit,
    handleSubmit: handleEditSubmit,
    reset: resetEdit,
    formState: { errors: editErrors, isSubmitting: editSubmitting },
  } = useForm<EditForm>({ resolver: zodResolver(editSchema) });

  const openEdit = (member: LibraryMember) => {
    setEditing(member);
    setEditError(null);
    resetEdit({ status: member.status, memberCode: member.memberCode ?? "" });
  };

  const onEdit = async (values: EditForm) => {
    if (!editing) return;
    setEditError(null);
    try {
      await api.patch(`/library/members/${editing.id}`, {
        status: values.status || undefined,
        memberCode: values.memberCode || undefined,
      });
      setEditing(null);
      await load();
    } catch (err) {
      setEditError(
        err instanceof ApiError ? err.message : "Failed to update member"
      );
    }
  };

  const removeMember = async (member: LibraryMember) => {
    if (!confirm(`Delete member ${member.name}?`)) return;
    try {
      await api.delete(`/library/members/${member.id}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete member");
    }
  };

  const openHistory = async (member: LibraryMember) => {
    setHistoryMember(member);
    setHistory([]);
    setHistoryError(null);
    setHistoryLoading(true);
    try {
      setHistory(
        await api.get<LibraryHistoryRow[]>(
          `/library/members/${member.id}/history`
        )
      );
    } catch (err) {
      setHistoryError(
        err instanceof ApiError ? err.message : "Failed to load history"
      );
    } finally {
      setHistoryLoading(false);
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Members" subtitle="Library members" />
        <Spinner />
      </>
    );
  }

  if (!can("library:read")) {
    return (
      <>
        <PageHeader title="Members" subtitle="Library members" />
        <EmptyState message="You do not have access to the library." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Members"
        subtitle="Library members & borrowing history"
        action={
          canCreate ? (
            <Button onClick={openRegister}>+ Register member</Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Link
          href="/library"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Library
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-64">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Search
          </span>
          <Input
            placeholder="Name or member code…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="w-48">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Type
          </span>
          <Select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
          >
            <option value="">All types</option>
            <option value="student">Student</option>
            <option value="staff">Staff</option>
          </Select>
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorNote message={loadError} />
      ) : members.length === 0 ? (
        <EmptyState message="No members found" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Member code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Open loans</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.map((member) => (
                <tr key={member.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">
                    {member.memberCode ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {member.name}
                    {member.identifier && (
                      <span className="block font-mono text-xs text-slate-400">
                        {member.identifier}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 capitalize">{member.memberType}</td>
                  <td className="px-4 py-3">{member.openLoans}</td>
                  <td className="px-4 py-3">
                    <Badge tone={memberStatusTone(member.status)}>
                      {member.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => openHistory(member)}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700"
                      >
                        History
                      </button>
                      {canUpdate && (
                        <button
                          onClick={() => openEdit(member)}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          Edit
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => removeMember(member)}
                          className="text-xs font-medium text-red-600 hover:text-red-700"
                        >
                          Delete
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

      {/* Register modal */}
      <Modal
        title="Register member"
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
      >
        <form onSubmit={handleSubmit(onRegister)} className="space-y-4">
          <Field label="Member type" error={errors.memberType?.message}>
            <Select {...register("memberType")}>
              <option value="student">Student</option>
              <option value="staff">Staff</option>
            </Select>
          </Field>
          {memberType === "staff" ? (
            <Field label="Staff member" error={errors.teacherId?.message}>
              <Select {...register("teacherId")}>
                <option value="">Select a staff member…</option>
                {teachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.firstName} {teacher.lastName} ({teacher.employeeNo})
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Student" error={errors.studentId?.message}>
              <Select {...register("studentId")}>
                <option value="">Select a student…</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.firstName} {student.lastName} (
                    {student.admissionNo})
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Member code" error={errors.memberCode?.message}>
            <Input
              placeholder="Auto-generated if blank"
              {...register("memberCode")}
            />
          </Field>
          <ErrorNote message={registerError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRegisterOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Registering…" : "Register member"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit modal */}
      <Modal
        title={editing ? `Edit member — ${editing.name}` : "Edit member"}
        open={!!editing}
        onClose={() => setEditing(null)}
      >
        <form onSubmit={handleEditSubmit(onEdit)} className="space-y-4">
          <Field label="Status" error={editErrors.status?.message}>
            <Select {...registerEdit("status")}>
              {MEMBER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Member code" error={editErrors.memberCode?.message}>
            <Input {...registerEdit("memberCode")} />
          </Field>
          <ErrorNote message={editError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={editSubmitting}>
              {editSubmitting ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* History modal */}
      <Modal
        title={
          historyMember ? `History — ${historyMember.name}` : "Borrowing history"
        }
        open={!!historyMember}
        onClose={() => setHistoryMember(null)}
      >
        {historyLoading ? (
          <Spinner />
        ) : historyError ? (
          <ErrorNote message={historyError} />
        ) : history.length === 0 ? (
          <EmptyState message="No borrowing history" />
        ) : (
          <div className="space-y-3">
            {history.map((row) => (
              <div
                key={row.id}
                className="rounded-lg border border-slate-200 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">
                    {row.title}
                  </p>
                  <Badge
                    tone={
                      row.status === "returned"
                        ? "slate"
                        : row.overdue
                          ? "red"
                          : "blue"
                    }
                  >
                    {row.overdue && row.status !== "returned"
                      ? "overdue"
                      : row.status}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Issued {fmtDate(row.issueDate)} · Due {fmtDate(row.dueDate)}
                  {row.returnDate
                    ? ` · Returned ${fmtDate(row.returnDate)}`
                    : ""}
                </p>
                {Number(row.fineAmount ?? 0) > 0 && (
                  <p className="mt-1 text-xs text-slate-500">
                    Fine: {row.fineAmount}
                    {row.fineStatus ? ` (${row.fineStatus})` : ""}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
