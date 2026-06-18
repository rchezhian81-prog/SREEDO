"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Button,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { ItemCategory } from "@/types";

const categorySchema = z.object({
  name: z.string().min(1, "Required"),
  code: z.string().optional(),
});

type CategoryForm = z.infer<typeof categorySchema>;

export default function CategoriesPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canCreate = can("inventory:create");
  const canUpdate = can("inventory:update");
  const canDelete = can("inventory:delete");

  const [categories, setCategories] = useState<ItemCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ItemCategory | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setCategories(await api.get<ItemCategory[]>("/inventory/categories"));
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
    reset({ name: "", code: "" });
    setModalOpen(true);
  };

  const openEdit = (category: ItemCategory) => {
    setEditing(category);
    setFormError(null);
    reset({ name: category.name, code: category.code ?? "" });
    setModalOpen(true);
  };

  const onSubmit = async (values: CategoryForm) => {
    setFormError(null);
    const body = {
      name: values.name,
      code: values.code || undefined,
    };
    try {
      if (editing) {
        await api.patch(`/inventory/categories/${editing.id}`, body);
      } else {
        await api.post("/inventory/categories", body);
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

  const removeCategory = async (category: ItemCategory) => {
    if (!confirm(`Delete category ${category.name}?`)) return;
    try {
      await api.delete(`/inventory/categories/${category.id}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete category");
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Categories" subtitle="Item categories" />
        <Spinner />
      </>
    );
  }

  if (!can("inventory:read")) {
    return (
      <>
        <PageHeader title="Categories" subtitle="Item categories" />
        <EmptyState message="You do not have access to inventory." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Categories"
        subtitle="Group items by category"
        action={
          canCreate ? (
            <Button onClick={openCreate}>+ Add category</Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Link
          href="/inventory"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Inventory
        </Link>
      </div>

      {loading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorNote message={loadError} />
      ) : categories.length === 0 ? (
        <EmptyState message="No categories yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Items</th>
                {(canUpdate || canDelete) && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {categories.map((category) => (
                <tr key={category.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {category.name}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {category.code ?? "—"}
                  </td>
                  <td className="px-4 py-3">{category.itemCount}</td>
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
                            onClick={() => removeCategory(category)}
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
        title={editing ? "Edit category" : "Add category"}
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
    </>
  );
}
