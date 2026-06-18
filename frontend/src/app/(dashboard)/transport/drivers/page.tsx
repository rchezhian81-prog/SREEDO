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
import type { Driver } from "@/types";

const driverSchema = z.object({
  name: z.string().min(1, "Required"),
  phone: z.string().optional(),
  licenseNumber: z.string().optional(),
  licenseExpiry: z.string().optional(),
  helperName: z.string().optional(),
  helperPhone: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
});

type DriverForm = z.infer<typeof driverSchema>;

/** Renders a licence expiry date as a Badge flagging expired / expiring (≤30 days). */
function ExpiryBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-slate-400">—</span>;
  const date = value.slice(0, 10);
  const target = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (Number.isNaN(days)) return <span className="text-slate-600">{date}</span>;
  if (days < 0) return <Badge tone="red">{date} · expired</Badge>;
  if (days <= 30) return <Badge tone="amber">{date} · {days}d</Badge>;
  return <Badge tone="green">{date}</Badge>;
}

export default function DriversPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canCreate = can("transport:create");
  const canUpdate = can("transport:update");
  const canDelete = can("transport:delete");

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setDrivers(await api.get<Driver[]>("/transport/drivers"));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load drivers"
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
  } = useForm<DriverForm>({ resolver: zodResolver(driverSchema) });

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    reset({
      name: "",
      phone: "",
      licenseNumber: "",
      licenseExpiry: "",
      helperName: "",
      helperPhone: "",
      isActive: true,
    });
    setModalOpen(true);
  };

  const openEdit = (driver: Driver) => {
    setEditing(driver);
    setFormError(null);
    reset({
      name: driver.name,
      phone: driver.phone ?? "",
      licenseNumber: driver.licenseNumber ?? "",
      licenseExpiry: driver.licenseExpiry?.slice(0, 10) ?? "",
      helperName: driver.helperName ?? "",
      helperPhone: driver.helperPhone ?? "",
      isActive: driver.isActive,
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: DriverForm) => {
    setFormError(null);
    const body: Record<string, unknown> = {
      name: values.name,
      phone: values.phone || undefined,
      licenseNumber: values.licenseNumber || undefined,
      licenseExpiry: values.licenseExpiry || undefined,
      helperName: values.helperName || undefined,
      helperPhone: values.helperPhone || undefined,
      isActive: values.isActive,
    };
    try {
      if (editing) {
        await api.patch(`/transport/drivers/${editing.id}`, body);
      } else {
        await api.post("/transport/drivers", body);
      }
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to save driver"
      );
    }
  };

  const removeDriver = async (driver: Driver) => {
    if (!confirm(`Delete driver ${driver.name}?`)) return;
    try {
      await api.delete(`/transport/drivers/${driver.id}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete driver");
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Drivers" subtitle="Drivers & helpers" />
        <Spinner />
      </>
    );
  }

  if (!can("transport:read")) {
    return (
      <>
        <PageHeader title="Drivers" subtitle="Drivers & helpers" />
        <EmptyState message="You do not have access to transport." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Drivers"
        subtitle="Drivers, helpers & licences"
        action={
          canCreate ? (
            <Button onClick={openCreate}>+ Add driver</Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Link
          href="/transport"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Transport
        </Link>
      </div>

      {loading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorNote message={loadError} />
      ) : drivers.length === 0 ? (
        <EmptyState message="No drivers yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Licence</th>
                <th className="px-4 py-3">Licence expiry</th>
                <th className="px-4 py-3">Helper</th>
                <th className="px-4 py-3">Status</th>
                {(canUpdate || canDelete) && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {drivers.map((driver) => (
                <tr key={driver.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {driver.name}
                    {driver.routeCount > 0 && (
                      <span className="block text-xs text-slate-400">
                        {driver.routeCount}{" "}
                        {driver.routeCount === 1 ? "route" : "routes"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{driver.phone ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {driver.licenseNumber ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <ExpiryBadge value={driver.licenseExpiry} />
                  </td>
                  <td className="px-4 py-3">
                    {driver.helperName ?? "—"}
                    {driver.helperPhone && (
                      <span className="block text-xs text-slate-400">
                        {driver.helperPhone}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={driver.isActive ? "green" : "slate"}>
                      {driver.isActive ? "active" : "inactive"}
                    </Badge>
                  </td>
                  {(canUpdate || canDelete) && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        {canUpdate && (
                          <button
                            onClick={() => openEdit(driver)}
                            className="text-xs font-medium text-brand-600 hover:text-brand-700"
                          >
                            Edit
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => removeDriver(driver)}
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
        title={editing ? "Edit driver" : "Add driver"}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" error={errors.name?.message}>
              <Input {...register("name")} />
            </Field>
            <Field label="Phone" error={errors.phone?.message}>
              <Input {...register("phone")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Licence number" error={errors.licenseNumber?.message}>
              <Input {...register("licenseNumber")} />
            </Field>
            <Field label="Licence expiry" error={errors.licenseExpiry?.message}>
              <Input type="date" {...register("licenseExpiry")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Helper name" error={errors.helperName?.message}>
              <Input {...register("helperName")} />
            </Field>
            <Field label="Helper phone" error={errors.helperPhone?.message}>
              <Input {...register("helperPhone")} />
            </Field>
          </div>
          <Field label="Status">
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
              {isSubmitting ? "Saving…" : "Save driver"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
