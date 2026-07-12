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
  Spinner,
  Textarea,
} from "@/components/ui";
import type { Vendor } from "@/types";

const vendorSchema = z.object({
  name: z.string().min(1, "Required"),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  gstNumber: z.string().optional(),
  address: z.string().optional(),
  paymentTerms: z.string().optional(),
});

type VendorForm = z.infer<typeof vendorSchema>;

export default function VendorsPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canCreate = can("inventory:create");
  const canUpdate = can("inventory:update");
  const canDelete = can("inventory:delete");

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Vendor | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setVendors(await api.get<Vendor[]>("/inventory/vendors"));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load vendors"
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
  } = useForm<VendorForm>({ resolver: zodResolver(vendorSchema) });

  const emptyForm: VendorForm = {
    name: "",
    contactPerson: "",
    phone: "",
    email: "",
    gstNumber: "",
    address: "",
    paymentTerms: "",
  };

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    reset(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (vendor: Vendor) => {
    setEditing(vendor);
    setFormError(null);
    reset({
      name: vendor.name,
      contactPerson: vendor.contactPerson ?? "",
      phone: vendor.phone ?? "",
      email: vendor.email ?? "",
      gstNumber: vendor.gstNumber ?? "",
      address: vendor.address ?? "",
      paymentTerms: vendor.paymentTerms ?? "",
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: VendorForm) => {
    setFormError(null);
    const body = {
      name: values.name,
      contactPerson: values.contactPerson || undefined,
      phone: values.phone || undefined,
      email: values.email || undefined,
      gstNumber: values.gstNumber || undefined,
      address: values.address || undefined,
      paymentTerms: values.paymentTerms || undefined,
    };
    try {
      if (editing) {
        await api.patch(`/inventory/vendors/${editing.id}`, body);
      } else {
        await api.post("/inventory/vendors", body);
      }
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to save vendor"
      );
    }
  };

  const confirmRemove = async () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      await api.delete(`/inventory/vendors/${pendingDelete.id}`);
      setPendingDelete(null);
      await load();
    } catch (err) {
      setDeleteError(
        err instanceof ApiError ? err.message : "Failed to delete vendor"
      );
    } finally {
      setDeleting(false);
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Vendors" subtitle="Suppliers & contacts" />
        <Spinner />
      </>
    );
  }

  if (!can("inventory:read")) {
    return (
      <>
        <PageHeader title="Vendors" subtitle="Suppliers & contacts" />
        <EmptyState message="You do not have access to inventory." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Vendors"
        subtitle="Suppliers & contacts"
        action={
          canCreate ? (
            <Button onClick={openCreate}>+ Add vendor</Button>
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
      ) : vendors.length === 0 ? (
        <EmptyState message="No vendors yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">GST</th>
                <th className="px-4 py-3">Terms</th>
                <th className="px-4 py-3">Status</th>
                {(canUpdate || canDelete) && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {vendors.map((vendor) => (
                <tr key={vendor.id} className="hover:bg-hover">
                  <td className="px-4 py-3 font-medium text-ink">
                    {vendor.name}
                    {vendor.email ? (
                      <span className="block text-xs text-faint">
                        {vendor.email}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{vendor.contactPerson ?? "—"}</td>
                  <td className="px-4 py-3">{vendor.phone ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {vendor.gstNumber ?? "—"}
                  </td>
                  <td className="px-4 py-3">{vendor.paymentTerms ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={vendor.isActive ? "green" : "slate"}>
                      {vendor.isActive ? "active" : "inactive"}
                    </Badge>
                  </td>
                  {(canUpdate || canDelete) && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        {canUpdate && (
                          <button
                            onClick={() => openEdit(vendor)}
                            className="text-xs font-medium text-brand-600 hover:text-brand-700"
                          >
                            Edit
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => {
                              setDeleteError(null);
                              setPendingDelete(vendor);
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
        title={editing ? "Edit vendor" : "Add vendor"}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Name" error={errors.name?.message}>
            <Input {...register("name")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Contact person"
              error={errors.contactPerson?.message}
            >
              <Input {...register("contactPerson")} />
            </Field>
            <Field label="Phone" error={errors.phone?.message}>
              <Input {...register("phone")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email" error={errors.email?.message}>
              <Input type="email" {...register("email")} />
            </Field>
            <Field label="GST number" error={errors.gstNumber?.message}>
              <Input {...register("gstNumber")} />
            </Field>
          </div>
          <Field label="Payment terms" error={errors.paymentTerms?.message}>
            <Input
              placeholder="e.g. Net 30"
              {...register("paymentTerms")}
            />
          </Field>
          <Field label="Address" error={errors.address?.message}>
            <Textarea rows={2} {...register("address")} />
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
              {isSubmitting ? "Saving…" : "Save vendor"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete vendor"
        message={
          <span className="space-y-2">
            <span className="block">
              Delete vendor <strong>{pendingDelete?.name}</strong>? This cannot
              be undone.
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
