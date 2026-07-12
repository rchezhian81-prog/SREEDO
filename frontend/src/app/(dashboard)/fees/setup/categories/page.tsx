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
import type { FeeCategory } from "@/types";

const categorySchema = z.object({
  name: z.string().min(1, "Required"),
  code: z.string().optional(),
  isActive: z.enum(["true", "false"]),
});

type CategoryForm = z.infer<typeof categorySchema>;

export default function FeeCategoriesPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canCreate = can("fee_categories:create");
  const canUpdate = can("fee_categories:update");
  const canDelete = can("fee_categories:delete");

  const [categories, setCategories] = useState<FeeCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FeeCategory | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FeeCategory | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setCategories(await api.get<FeeCategory[]>("/fees/categories"));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load categories"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CategoryForm>({ resolver: zodResolver(categorySchema) });

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    reset({ name: "", code: "", isActive: "true" });
    setModalOpen(true);
  };

  const openEdit = (category: FeeCategory) => {
    setEditing(category);
    setFormError(null);
    reset({
      name: category.name,
      code: category.code ?? "",
      isActive: category.isActive ? "true" : "false",
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: CategoryForm) => {
    setFormError(null);
    const body = {
      name: values.name,
      code: values.code || undefined,
      isActive: values.isActive === "true",
    };
    try {
      if (editing) {
        await api.patch(`/fees/categories/${editing.id}`, body);
      } else {
        await api.post("/fees/categories", body);
      }
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to save category"
      );
    }
  };

  const confirmRemoveCategory = async () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      await api.delete(`/fees/categories/${pendingDelete.id}`);
      setPendingDelete(null);
      await load();
    } catch (err) {
      setDeleteError(
        err instanceof ApiError ? err.message : "Failed to delete category"
      );
    } finally {
      setDeleting(false);
    }
  };

  if (!loading && !can("fee_categories:read")) {
    return (
      <>
        <PageHeader title="Fee categories" subtitle="Fee categories" />
        <EmptyState message="You don't have permission to view this page." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Fee categories"
        subtitle="Group fees by category"
        action={
          canCreate ? (
            <Button onClick={openCreate}>+ New category</Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Link
          href="/fees/setup"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Fee Setup
        </Link>
      </div>

      {loading || permsLoading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorNote message={loadError} />
      ) : categories.length === 0 ? (
        <EmptyState message="No categories yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Status</th>
                {(canUpdate || canDelete) && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {categories.map((category) => (
                <tr key={category.id} className="hover:bg-hover">
                  <td className="px-4 py-3 font-medium text-ink">
                    {category.name}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {category.code ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={category.isActive ? "green" : "slate"}>
                      {category.isActive ? "active" : "inactive"}
                    </Badge>
                  </td>
                  {(canUpdate || canDelete) && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        {canUpdate && (
                          <button
                            onClick={() => openEdit(category)}
                            className="text-xs font-medium text-brand-600 hover:text-brand-700"
                          >
                            Edit
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => {
                              setDeleteError(null);
                              setPendingDelete(category);
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
        title={editing ? "Edit category" : "New category"}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Name" error={errors.name?.message}>
            <Input {...register("name")} />
          </Field>
          <Field label="Code (optional)" error={errors.code?.message}>
            <Input {...register("code")} />
          </Field>
          <Field label="Status" error={errors.isActive?.message}>
            <Select {...register("isActive")}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </Select>
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
              {isSubmitting ? "Saving…" : "Save category"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete category"
        message={
          <span className="space-y-2">
            <span className="block">
              Delete category <strong>{pendingDelete?.name}</strong>? This cannot
              be undone.
            </span>
            {deleteError && <ErrorNote message={deleteError} />}
          </span>
        }
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={confirmRemoveCategory}
        onClose={() => setPendingDelete(null)}
      />
    </>
  );
}
