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
import type { Vehicle } from "@/types";

const vehicleSchema = z.object({
  registrationNo: z.string().min(1, "Required"),
  type: z.string().optional(),
  capacity: z.coerce.number().int().min(0).optional().or(z.literal("")),
  insuranceExpiry: z.string().optional(),
  fitnessExpiry: z.string().optional(),
  permitExpiry: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
});

type VehicleForm = z.infer<typeof vehicleSchema>;

/** Renders a date as a Badge flagging expired / expiring (≤30 days). */
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

export default function VehiclesPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canCreate = can("transport:create");
  const canUpdate = can("transport:update");
  const canDelete = can("transport:delete");

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setVehicles(await api.get<Vehicle[]>("/transport/vehicles"));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load vehicles"
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
  } = useForm<VehicleForm>({ resolver: zodResolver(vehicleSchema) });

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    reset({
      registrationNo: "",
      type: "",
      capacity: "",
      insuranceExpiry: "",
      fitnessExpiry: "",
      permitExpiry: "",
      isActive: true,
    });
    setModalOpen(true);
  };

  const openEdit = (vehicle: Vehicle) => {
    setEditing(vehicle);
    setFormError(null);
    reset({
      registrationNo: vehicle.registrationNo,
      type: vehicle.type ?? "",
      capacity: vehicle.capacity ?? "",
      insuranceExpiry: vehicle.insuranceExpiry?.slice(0, 10) ?? "",
      fitnessExpiry: vehicle.fitnessExpiry?.slice(0, 10) ?? "",
      permitExpiry: vehicle.permitExpiry?.slice(0, 10) ?? "",
      isActive: vehicle.isActive,
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: VehicleForm) => {
    setFormError(null);
    const body: Record<string, unknown> = {
      registrationNo: values.registrationNo,
      type: values.type || undefined,
      capacity: values.capacity === "" ? undefined : values.capacity,
      insuranceExpiry: values.insuranceExpiry || undefined,
      fitnessExpiry: values.fitnessExpiry || undefined,
      permitExpiry: values.permitExpiry || undefined,
      isActive: values.isActive,
    };
    try {
      if (editing) {
        await api.patch(`/transport/vehicles/${editing.id}`, body);
      } else {
        await api.post("/transport/vehicles", body);
      }
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to save vehicle"
      );
    }
  };

  const removeVehicle = async (vehicle: Vehicle) => {
    if (!confirm(`Delete vehicle ${vehicle.registrationNo}?`)) return;
    try {
      await api.delete(`/transport/vehicles/${vehicle.id}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete vehicle");
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Vehicles" subtitle="Fleet" />
        <Spinner />
      </>
    );
  }

  if (!can("transport:read")) {
    return (
      <>
        <PageHeader title="Vehicles" subtitle="Fleet" />
        <EmptyState message="You do not have access to transport." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Vehicles"
        subtitle="Fleet & document expiry"
        action={
          canCreate ? (
            <Button onClick={openCreate}>+ Add vehicle</Button>
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
      ) : vehicles.length === 0 ? (
        <EmptyState message="No vehicles yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Registration</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Capacity</th>
                <th className="px-4 py-3">Insurance</th>
                <th className="px-4 py-3">Fitness</th>
                <th className="px-4 py-3">Permit</th>
                <th className="px-4 py-3">Status</th>
                {(canUpdate || canDelete) && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vehicles.map((vehicle) => (
                <tr key={vehicle.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {vehicle.registrationNo}
                    {vehicle.routeCount > 0 && (
                      <span className="block text-xs text-slate-400">
                        {vehicle.routeCount}{" "}
                        {vehicle.routeCount === 1 ? "route" : "routes"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{vehicle.type ?? "—"}</td>
                  <td className="px-4 py-3">{vehicle.capacity ?? "—"}</td>
                  <td className="px-4 py-3">
                    <ExpiryBadge value={vehicle.insuranceExpiry} />
                  </td>
                  <td className="px-4 py-3">
                    <ExpiryBadge value={vehicle.fitnessExpiry} />
                  </td>
                  <td className="px-4 py-3">
                    <ExpiryBadge value={vehicle.permitExpiry} />
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={vehicle.isActive ? "green" : "slate"}>
                      {vehicle.isActive ? "active" : "inactive"}
                    </Badge>
                  </td>
                  {(canUpdate || canDelete) && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        {canUpdate && (
                          <button
                            onClick={() => openEdit(vehicle)}
                            className="text-xs font-medium text-brand-600 hover:text-brand-700"
                          >
                            Edit
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => removeVehicle(vehicle)}
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
        title={editing ? "Edit vehicle" : "Add vehicle"}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Registration no"
              error={errors.registrationNo?.message}
            >
              <Input {...register("registrationNo")} />
            </Field>
            <Field label="Type" error={errors.type?.message}>
              <Input placeholder="Bus, van…" {...register("type")} />
            </Field>
          </div>
          <Field label="Capacity" error={errors.capacity?.message}>
            <Input type="number" min={0} {...register("capacity")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Insurance expiry"
              error={errors.insuranceExpiry?.message}
            >
              <Input type="date" {...register("insuranceExpiry")} />
            </Field>
            <Field
              label="Fitness expiry"
              error={errors.fitnessExpiry?.message}
            >
              <Input type="date" {...register("fitnessExpiry")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Permit expiry" error={errors.permitExpiry?.message}>
              <Input type="date" {...register("permitExpiry")} />
            </Field>
            <Field label="Status">
              <Select {...register("isActive")}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </Select>
            </Field>
          </div>
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
              {isSubmitting ? "Saving…" : "Save vehicle"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
