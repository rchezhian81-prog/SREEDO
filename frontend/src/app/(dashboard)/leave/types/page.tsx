"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
  Modal,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { LeaveBalance, LeaveType, Paginated, Teacher } from "@/types";

export default function LeaveTypesPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canManage = can("leave:approve");

  const [types, setTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Type modal.
  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [editingType, setEditingType] = useState<LeaveType | null>(null);
  const [typeForm, setTypeForm] = useState({
    name: "",
    code: "",
    isPaid: true,
    defaultBalance: 0,
  });
  const [typeError, setTypeError] = useState<string | null>(null);
  const [typeSaving, setTypeSaving] = useState(false);

  // Balance upsert.
  const [balForm, setBalForm] = useState({
    teacherId: "",
    leaveTypeId: "",
    balance: 0,
  });
  const [balError, setBalError] = useState<string | null>(null);
  const [balSaving, setBalSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [typeList, balanceList, teacherPage] = await Promise.all([
        api.get<LeaveType[]>("/leave/types"),
        api.get<LeaveBalance[]>("/leave/balances"),
        api.get<Paginated<Teacher>>("/teachers?limit=200"),
      ]);
      setTypes(typeList);
      setBalances(balanceList);
      setTeachers(teacherPage.data);
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load leave setup"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (permsLoading || !canManage) return;
    load();
  }, [permsLoading, canManage, load]);

  const openCreateType = () => {
    setEditingType(null);
    setTypeForm({ name: "", code: "", isPaid: true, defaultBalance: 0 });
    setTypeError(null);
    setTypeModalOpen(true);
  };

  const openEditType = (type: LeaveType) => {
    setEditingType(type);
    setTypeForm({
      name: type.name,
      code: type.code,
      isPaid: type.isPaid,
      defaultBalance: type.defaultBalance,
    });
    setTypeError(null);
    setTypeModalOpen(true);
  };

  const submitType = async (event: React.FormEvent) => {
    event.preventDefault();
    setTypeSaving(true);
    setTypeError(null);
    const body = {
      name: typeForm.name,
      code: typeForm.code,
      isPaid: typeForm.isPaid,
      defaultBalance: Number(typeForm.defaultBalance) || 0,
    };
    try {
      if (editingType) {
        await api.patch(`/leave/types/${editingType.id}`, body);
      } else {
        await api.post("/leave/types", body);
      }
      setTypeModalOpen(false);
      await load();
    } catch (err) {
      setTypeError(
        err instanceof ApiError ? err.message : "Failed to save leave type"
      );
    } finally {
      setTypeSaving(false);
    }
  };

  const removeType = async (type: LeaveType) => {
    if (!confirm(`Delete leave type ${type.name}?`)) return;
    try {
      await api.delete(`/leave/types/${type.id}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete type");
    }
  };

  const submitBalance = async (event: React.FormEvent) => {
    event.preventDefault();
    setBalSaving(true);
    setBalError(null);
    try {
      await api.post("/leave/balances", {
        teacherId: balForm.teacherId,
        leaveTypeId: balForm.leaveTypeId,
        balance: Number(balForm.balance) || 0,
      });
      setBalForm({ teacherId: "", leaveTypeId: "", balance: 0 });
      await load();
    } catch (err) {
      setBalError(
        err instanceof ApiError ? err.message : "Failed to save balance"
      );
    } finally {
      setBalSaving(false);
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Leave types & setup" subtitle="Types and balances" />
        <Spinner />
      </>
    );
  }

  if (!canManage) {
    return (
      <>
        <PageHeader title="Leave types & setup" subtitle="Types and balances" />
        <EmptyState message="You do not have permission to manage leave setup." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Leave types & setup"
        subtitle="Types and balance setup"
        action={<Button onClick={openCreateType}>+ Add leave type</Button>}
      />

      <div className="mb-4">
        <Link
          href="/leave"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Leave
        </Link>
      </div>

      <ErrorNote message={loadError} />

      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 text-lg font-semibold text-slate-900">
              Leave types
            </h2>
            {types.length === 0 ? (
              <EmptyState message="No leave types yet" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Code</th>
                      <th className="px-4 py-3">Paid</th>
                      <th className="px-4 py-3">Default balance</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {types.map((type) => (
                      <tr key={type.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {type.name}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {type.code}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={type.isPaid ? "green" : "slate"}>
                            {type.isPaid ? "paid" : "unpaid"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">{type.defaultBalance}</td>
                        <td className="px-4 py-3">
                          <Badge tone={type.isActive ? "green" : "slate"}>
                            {type.isActive ? "active" : "inactive"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-3">
                            <button
                              onClick={() => openEditType(type)}
                              className="text-xs font-medium text-brand-600 hover:text-brand-700"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => removeType(type)}
                              className="text-xs font-medium text-red-600 hover:text-red-700"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-semibold text-slate-900">
              Set staff balance
            </h2>
            <form
              onSubmit={submitBalance}
              className="flex flex-wrap items-end gap-3"
            >
              <div className="w-64">
                <span className="mb-1 block text-sm font-medium text-slate-700">
                  Staff
                </span>
                <Select
                  value={balForm.teacherId}
                  required
                  onChange={(event) =>
                    setBalForm((f) => ({ ...f, teacherId: event.target.value }))
                  }
                >
                  <option value="" disabled>
                    Select staff
                  </option>
                  {teachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.firstName} {teacher.lastName} (
                      {teacher.employeeNo})
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-48">
                <span className="mb-1 block text-sm font-medium text-slate-700">
                  Leave type
                </span>
                <Select
                  value={balForm.leaveTypeId}
                  required
                  onChange={(event) =>
                    setBalForm((f) => ({
                      ...f,
                      leaveTypeId: event.target.value,
                    }))
                  }
                >
                  <option value="" disabled>
                    Select type
                  </option>
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-32">
                <span className="mb-1 block text-sm font-medium text-slate-700">
                  Balance
                </span>
                <Input
                  type="number"
                  step="0.5"
                  value={balForm.balance}
                  onChange={(event) =>
                    setBalForm((f) => ({
                      ...f,
                      balance: Number(event.target.value),
                    }))
                  }
                />
              </div>
              <Button type="submit" disabled={balSaving}>
                {balSaving ? "Saving…" : "Save balance"}
              </Button>
            </form>
            <div className="mt-3">
              <ErrorNote message={balError} />
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-semibold text-slate-900">
              Balances
            </h2>
            {balances.length === 0 ? (
              <EmptyState message="No balances set" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Staff</th>
                      <th className="px-4 py-3">Leave type</th>
                      <th className="px-4 py-3">Paid</th>
                      <th className="px-4 py-3">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {balances.map((bal) => (
                      <tr key={bal.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {bal.teacherName}
                        </td>
                        <td className="px-4 py-3">{bal.leaveTypeName}</td>
                        <td className="px-4 py-3">
                          <Badge tone={bal.isPaid ? "green" : "slate"}>
                            {bal.isPaid ? "paid" : "unpaid"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">{bal.balance}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      <Modal
        title={editingType ? "Edit leave type" : "Add leave type"}
        open={typeModalOpen}
        onClose={() => setTypeModalOpen(false)}
      >
        <form onSubmit={submitType} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <Input
                value={typeForm.name}
                required
                onChange={(event) =>
                  setTypeForm((f) => ({ ...f, name: event.target.value }))
                }
              />
            </Field>
            <Field label="Code">
              <Input
                value={typeForm.code}
                required
                onChange={(event) =>
                  setTypeForm((f) => ({ ...f, code: event.target.value }))
                }
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Default balance">
              <Input
                type="number"
                step="0.5"
                value={typeForm.defaultBalance}
                onChange={(event) =>
                  setTypeForm((f) => ({
                    ...f,
                    defaultBalance: Number(event.target.value),
                  }))
                }
              />
            </Field>
            <label className="flex items-end gap-2 pb-2">
              <input
                type="checkbox"
                checked={typeForm.isPaid}
                onChange={(event) =>
                  setTypeForm((f) => ({ ...f, isPaid: event.target.checked }))
                }
                className="h-4 w-4 rounded border-slate-300"
              />
              <span className="text-sm font-medium text-slate-700">
                Paid leave
              </span>
            </label>
          </div>
          <ErrorNote message={typeError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setTypeModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={typeSaving}>
              {typeSaving ? "Saving…" : "Save leave type"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
