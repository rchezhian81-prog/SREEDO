"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import { money } from "@/lib/payroll";
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
  Select,
  Spinner,
} from "@/components/ui";
import type { SalaryComponent } from "@/types";

const componentSchema = z.object({
  name: z.string().min(1, "Required"),
  code: z.string().min(1, "Required"),
  type: z.enum(["earning", "deduction"]),
  calcType: z.enum(["fixed", "percent"]),
  defaultValue: z.coerce.number().min(0, "Must be ≥ 0").optional(),
});

type ComponentForm = z.infer<typeof componentSchema>;

export default function PayrollComponentsPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canCreate = can("payroll:create");
  const canUpdate = can("payroll:update");
  const canDelete = can("payroll:delete");

  const [components, setComponents] = useState<SalaryComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SalaryComponent | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SalaryComponent | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setComponents(await api.get<SalaryComponent[]>("/payroll/components"));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load components"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (permsLoading || !can("payroll:read")) {
      setLoading(false);
      return;
    }
    load();
  }, [permsLoading, can, load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ComponentForm>({ resolver: zodResolver(componentSchema) });

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    reset({
      name: "",
      code: "",
      type: "earning",
      calcType: "fixed",
      defaultValue: 0,
    });
    setModalOpen(true);
  };

  const openEdit = (component: SalaryComponent) => {
    setEditing(component);
    setFormError(null);
    reset({
      name: component.name,
      code: component.code,
      type: component.type,
      calcType: component.calcType,
      defaultValue: Number(component.defaultValue ?? 0),
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: ComponentForm) => {
    setFormError(null);
    const body = {
      name: values.name,
      code: values.code,
      type: values.type,
      calcType: values.calcType,
      defaultValue: values.defaultValue ?? 0,
    };
    try {
      if (editing) {
        await api.patch(`/payroll/components/${editing.id}`, body);
      } else {
        await api.post("/payroll/components", body);
      }
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to save component"
      );
    }
  };

  const confirmRemove = async () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      await api.delete(`/payroll/components/${pendingDelete.id}`);
      setPendingDelete(null);
      await load();
    } catch (err) {
      setDeleteError(
        err instanceof ApiError ? err.message : "Failed to delete component"
      );
    } finally {
      setDeleting(false);
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Salary components" subtitle="Earnings & deductions" />
        <Spinner />
      </>
    );
  }

  if (!can("payroll:read")) {
    return (
      <>
        <PageHeader title="Salary components" subtitle="Earnings & deductions" />
        <EmptyState message="You do not have access to payroll." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Salary components"
        subtitle="Earnings & deductions catalogue"
        action={
          canCreate ? (
            <Button onClick={openCreate}>+ Add component</Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Link
          href="/payroll"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Payroll
        </Link>
      </div>

      {loading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorNote message={loadError} />
      ) : components.length === 0 ? (
        <EmptyState message="No salary components yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Calc</th>
                <th className="px-4 py-3 text-right">Default</th>
                <th className="px-4 py-3">Active</th>
                {(canUpdate || canDelete) && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {components.map((component) => (
                <tr key={component.id} className="hover:bg-hover">
                  <td className="px-4 py-3 font-medium text-ink">
                    {component.name}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {component.code}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={component.type === "earning" ? "green" : "red"}>
                      {component.type}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone="slate">{component.calcType}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {component.calcType === "percent"
                      ? `${money(component.defaultValue)}%`
                      : money(component.defaultValue)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={component.isActive ? "green" : "slate"}>
                      {component.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  {(canUpdate || canDelete) && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        {canUpdate && (
                          <button
                            onClick={() => openEdit(component)}
                            className="text-xs font-medium text-brand-600 hover:text-brand-700"
                          >
                            Edit
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => {
                              setDeleteError(null);
                              setPendingDelete(component);
                            }}
                            className="text-xs font-medium text-red-600 hover:text-red-700"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        title={editing ? "Edit component" : "Add component"}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Name" error={errors.name?.message}>
            <Input placeholder="Basic" {...register("name")} />
          </Field>
          <Field label="Code" error={errors.code?.message}>
            <Input placeholder="BASIC" {...register("code")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type" error={errors.type?.message}>
              <Select {...register("type")}>
                <option value="earning">Earning</option>
                <option value="deduction">Deduction</option>
              </Select>
            </Field>
            <Field label="Calc type" error={errors.calcType?.message}>
              <Select {...register("calcType")}>
                <option value="fixed">Fixed</option>
                <option value="percent">Percent</option>
              </Select>
            </Field>
          </div>
          <Field
            label="Default value"
            error={errors.defaultValue?.message}
          >
            <Input
              type="number"
              step="0.01"
              {...register("defaultValue")}
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
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save component"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete component"
        message={
          <span className="space-y-2">
            <span className="block">
              Delete component <strong>{pendingDelete?.name}</strong>? This
              cannot be undone.
            </span>
            {deleteError && <ErrorNote message={deleteError} />}
          </span>
        }
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={confirmRemove}
        onClose={() => setPendingDelete(null)}
      />
    </>
  );
}
