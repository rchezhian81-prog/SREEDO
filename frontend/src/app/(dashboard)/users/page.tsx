"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
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
import type { AccountUser, Paginated, UserRole } from "@/types";

const ROLES: UserRole[] = [
  "admin",
  "teacher",
  "accountant",
  "student",
  "parent",
];

const roleEnum = z.enum(["admin", "teacher", "accountant", "student", "parent"]);

const createSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z
    .string()
    .min(8, "At least 8 characters")
    .regex(/[A-Za-z]/, "Needs a letter")
    .regex(/[0-9]/, "Needs a digit"),
  fullName: z.string().min(1, "Required"),
  role: roleEnum,
  phone: z.string().optional(),
});
type CreateForm = z.infer<typeof createSchema>;

const editSchema = z.object({
  fullName: z.string().min(1, "Required"),
  phone: z.string().optional(),
  role: roleEnum,
  isActive: z.boolean(),
});
type EditForm = z.infer<typeof editSchema>;

export default function UsersPage() {
  const role = useAuthStore((state) => state.user?.role);
  const isAdmin = role === "admin";

  const [users, setUsers] = useState<AccountUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<AccountUser | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const limit = 10;

  const load = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (search) params.set("search", search);
      if (roleFilter) params.set("role", roleFilter);
      const result = await api.get<Paginated<AccountUser>>(
        `/users?${params.toString()}`
      );
      setUsers(result.data);
      setTotal(result.meta.total);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, page, search, roleFilter]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const addForm = useForm<CreateForm>({ resolver: zodResolver(createSchema) });
  const editForm = useForm<EditForm>({ resolver: zodResolver(editSchema) });

  const openEdit = (user: AccountUser) => {
    setServerError(null);
    setEditing(user);
    editForm.reset({
      fullName: user.fullName,
      phone: user.phone ?? "",
      role: user.role,
      isActive: user.isActive,
    });
  };

  const onCreate = async (values: CreateForm) => {
    setServerError(null);
    try {
      await api.post("/users", { ...values, phone: values.phone || undefined });
      setAddOpen(false);
      addForm.reset();
      await load();
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Failed to create user"
      );
    }
  };

  const onEdit = async (values: EditForm) => {
    if (!editing) return;
    setServerError(null);
    try {
      await api.patch(`/users/${editing.id}`, {
        fullName: values.fullName,
        phone: values.phone || null,
        role: values.role,
        isActive: values.isActive,
      });
      setEditing(null);
      await load();
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Failed to update user"
      );
    }
  };

  const deactivate = async (user: AccountUser) => {
    if (!confirm(`Deactivate ${user.fullName} and revoke their sessions?`))
      return;
    await api.delete(`/users/${user.id}`);
    await load();
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Users" />
        <EmptyState message="Only administrators can manage user accounts." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Users"
        subtitle={`${total} account${total === 1 ? "" : "s"}`}
        action={<Button onClick={() => setAddOpen(true)}>+ Add user</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="max-w-xs flex-1">
          <Input
            placeholder="Search by name or email…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-44">
          <Select
            value={roleFilter}
            onChange={(event) => {
              setRoleFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : users.length === 0 ? (
        <EmptyState message="No users found" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {user.fullName}
                    {user.phone && (
                      <span className="block text-xs text-slate-400">
                        {user.phone}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{user.email}</td>
                  <td className="px-4 py-3 capitalize">{user.role}</td>
                  <td className="px-4 py-3">
                    <Badge tone={user.isActive ? "green" : "slate"}>
                      {user.isActive ? "active" : "inactive"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => openEdit(user)}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700"
                      >
                        Edit
                      </button>
                      {user.isActive && (
                        <button
                          onClick={() => deactivate(user)}
                          className="text-xs font-medium text-red-600 hover:text-red-700"
                        >
                          Deactivate
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

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <Button
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <span className="text-slate-500">
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

      <Modal title="Add user" open={addOpen} onClose={() => setAddOpen(false)}>
        <form
          onSubmit={addForm.handleSubmit(onCreate)}
          className="space-y-4"
        >
          <Field label="Full name" error={addForm.formState.errors.fullName?.message}>
            <Input {...addForm.register("fullName")} />
          </Field>
          <Field label="Email" error={addForm.formState.errors.email?.message}>
            <Input type="email" {...addForm.register("email")} />
          </Field>
          <Field label="Password" error={addForm.formState.errors.password?.message}>
            <Input type="password" {...addForm.register("password")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role" error={addForm.formState.errors.role?.message}>
              <Select {...addForm.register("role")}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Phone">
              <Input {...addForm.register("phone")} />
            </Field>
          </div>
          <ErrorNote message={serverError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAddOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={addForm.formState.isSubmitting}>
              {addForm.formState.isSubmitting ? "Saving…" : "Create user"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        title="Edit user"
        open={editing !== null}
        onClose={() => setEditing(null)}
      >
        <form onSubmit={editForm.handleSubmit(onEdit)} className="space-y-4">
          <p className="text-sm text-slate-500">{editing?.email}</p>
          <Field
            label="Full name"
            error={editForm.formState.errors.fullName?.message}
          >
            <Input {...editForm.register("fullName")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role" error={editForm.formState.errors.role?.message}>
              <Select {...editForm.register("role")}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Phone">
              <Input {...editForm.register("phone")} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" {...editForm.register("isActive")} />
            Account active
          </label>
          <ErrorNote message={serverError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={editForm.formState.isSubmitting}>
              {editForm.formState.isSubmitting ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
