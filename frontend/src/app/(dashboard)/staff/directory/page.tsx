"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import { toast } from "@/components/toast";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { Paginated } from "@/types";

/**
 * Non-teaching staff are stored in the same backend resource as teachers,
 * distinguished by `staffType`. This directory manages ONLY non-teaching staff:
 * every list request is scoped with `staffType=non_teaching` and every create
 * sends `staffType: "non_teaching"` so new rows land here (not in Teachers).
 * The shared `Teacher` type omits the directory-specific columns, so we shape a
 * local row type for this page.
 */
interface Staff {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  staffType: string;
  designation: string | null;
  department: string | null;
  isActive: boolean;
  createdAt: string;
}

const staffSchema = z.object({
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  employeeNo: z.string().optional(),
  designation: z.string().optional(),
  department: z.string().optional(),
  email: z.string().email("Enter a valid email").optional().or(z.literal("")),
  phone: z.string().optional(),
});

type StaffForm = z.infer<typeof staffSchema>;

const LIMIT = 10;

export default function StaffDirectoryPage() {
  const { can } = usePermissions();
  const canManage = can("teachers:manage");

  const [staff, setStaff] = useState<Staff[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const [deleteFor, setDeleteFor] = useState<Staff | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({
        staffType: "non_teaching",
        page: String(page),
        limit: String(LIMIT),
      });
      if (search) params.set("search", search);
      const result = await api.get<Paginated<Staff>>(
        `/teachers?${params.toString()}`
      );
      setStaff(result.data);
      setTotal(result.meta.total);
    } catch (err) {
      setStaff([]);
      setLoadError(err instanceof ApiError ? err.message : "Failed to load staff");
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    load();
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<StaffForm>({ resolver: zodResolver(staffSchema) });

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const openAdd = () => {
    setEditing(null);
    setServerError(null);
    reset({
      firstName: "",
      lastName: "",
      employeeNo: "",
      designation: "",
      department: "",
      email: "",
      phone: "",
    });
    setModalOpen(true);
  };

  const openEdit = (member: Staff) => {
    setEditing(member);
    setServerError(null);
    reset({
      firstName: member.firstName,
      lastName: member.lastName,
      employeeNo: member.employeeNo ?? "",
      designation: member.designation ?? "",
      department: member.department ?? "",
      email: member.email ?? "",
      phone: member.phone ?? "",
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: StaffForm) => {
    setServerError(null);
    const payload = {
      firstName: values.firstName,
      lastName: values.lastName,
      employeeNo: values.employeeNo || undefined,
      designation: values.designation || undefined,
      department: values.department || undefined,
      email: values.email || undefined,
      phone: values.phone || undefined,
    };
    try {
      if (editing) {
        await api.patch(`/teachers/${editing.id}`, payload);
        toast.success("Staff member updated");
      } else {
        // Always tag the create so the new record lands in this directory.
        await api.post("/teachers", { ...payload, staffType: "non_teaching" });
        toast.success("Staff member added");
      }
      closeModal();
      reset();
      await load();
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Failed to save staff member"
      );
    }
  };

  const confirmDelete = async () => {
    if (!deleteFor) return;
    setDeleting(true);
    try {
      await api.delete(`/teachers/${deleteFor.id}`);
      toast.success("Staff member removed");
      setDeleteFor(null);
      // Stepping back a page when the last row on it is removed avoids landing
      // on an empty page; otherwise just refresh in place.
      if (staff.length === 1 && page > 1) {
        setPage((p) => p - 1);
      } else {
        await load();
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to remove staff member"
      );
    } finally {
      setDeleting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <>
      <PageHeader
        title="Staff Directory"
        subtitle="Non-teaching staff"
        action={
          canManage ? <Button onClick={openAdd}>+ Add staff</Button> : undefined
        }
      />

      <div className="mb-4 max-w-xs">
        <Input
          placeholder="Search by name or employee no…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </div>

      {loading ? (
        <Spinner />
      ) : loadError ? (
        <div className="space-y-3">
          <ErrorNote message={loadError} />
          <Button variant="secondary" onClick={() => load()}>
            Retry
          </Button>
        </div>
      ) : staff.length === 0 ? (
        <EmptyState message="No non-teaching staff yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Employee No</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Designation</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Status</th>
                {canManage && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {staff.map((member) => (
                <tr key={member.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3 font-mono text-xs">
                    {member.employeeNo}
                  </td>
                  <td className="px-4 py-3 font-medium text-ink">
                    {member.firstName} {member.lastName}
                  </td>
                  <td className="px-4 py-3">{member.designation ?? "—"}</td>
                  <td className="px-4 py-3">{member.department ?? "—"}</td>
                  <td className="px-4 py-3">
                    {member.email ?? "—"}
                    {member.phone && (
                      <span className="block text-xs text-faint">
                        {member.phone}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={member.isActive ? "green" : "slate"}>
                      {member.isActive ? "active" : "inactive"}
                    </Badge>
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          onClick={() => openEdit(member)}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleteFor(member)}
                          className="text-xs font-medium text-red-600 hover:text-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <Button
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <span className="text-muted">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="secondary"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}

      <Modal
        title={editing ? "Edit staff" : "Add staff"}
        open={modalOpen}
        onClose={closeModal}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" error={errors.firstName?.message}>
              <Input {...register("firstName")} />
            </Field>
            <Field label="Last name" error={errors.lastName?.message}>
              <Input {...register("lastName")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Designation">
              <Input
                placeholder="Accountant, Clerk, Driver…"
                {...register("designation")}
              />
            </Field>
            <Field label="Department">
              <Input
                placeholder="Administration, Accounts…"
                {...register("department")}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email" error={errors.email?.message}>
              <Input type="email" {...register("email")} />
            </Field>
            <Field label="Phone">
              <Input {...register("phone")} />
            </Field>
          </div>
          <Field label="Employee No" hint="Auto-generated when blank">
            <Input {...register("employeeNo")} />
          </Field>
          <ErrorNote message={serverError} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? "Saving…"
                : editing
                  ? "Save changes"
                  : "Save staff"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteFor}
        title="Remove staff member"
        message={
          deleteFor
            ? `Remove ${deleteFor.firstName} ${deleteFor.lastName} from staff?`
            : ""
        }
        confirmLabel="Remove"
        busy={deleting}
        onConfirm={confirmDelete}
        onClose={() => setDeleteFor(null)}
      />
    </>
  );
}
