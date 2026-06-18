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
import type { Driver, TransportRoute, Vehicle } from "@/types";

const routeSchema = z.object({
  name: z.string().min(1, "Required"),
  code: z.string().min(1, "Required"),
  vehicleId: z.string().optional(),
  driverId: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
});

type RouteForm = z.infer<typeof routeSchema>;

export default function RoutesPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canCreate = can("transport:create");
  const canUpdate = can("transport:update");
  const canDelete = can("transport:delete");

  const [routes, setRoutes] = useState<TransportRoute[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TransportRoute | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [routeList, vehicleList, driverList] = await Promise.all([
        api.get<TransportRoute[]>("/transport/routes"),
        api.get<Vehicle[]>("/transport/vehicles"),
        api.get<Driver[]>("/transport/drivers"),
      ]);
      setRoutes(routeList);
      setVehicles(vehicleList);
      setDrivers(driverList);
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load routes"
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
  } = useForm<RouteForm>({ resolver: zodResolver(routeSchema) });

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    reset({ name: "", code: "", vehicleId: "", driverId: "", isActive: true });
    setModalOpen(true);
  };

  const openEdit = (route: TransportRoute) => {
    setEditing(route);
    setFormError(null);
    reset({
      name: route.name,
      code: route.code,
      vehicleId: route.vehicleId ?? "",
      driverId: route.driverId ?? "",
      isActive: route.isActive,
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: RouteForm) => {
    setFormError(null);
    const body: Record<string, unknown> = {
      name: values.name,
      code: values.code,
      vehicleId: values.vehicleId || undefined,
      driverId: values.driverId || undefined,
      isActive: values.isActive,
    };
    try {
      if (editing) {
        await api.patch(`/transport/routes/${editing.id}`, body);
      } else {
        await api.post("/transport/routes", body);
      }
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to save route"
      );
    }
  };

  const removeRoute = async (route: TransportRoute) => {
    if (!confirm(`Delete route ${route.name}?`)) return;
    try {
      await api.delete(`/transport/routes/${route.id}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete route");
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Routes" subtitle="Routes & stops" />
        <Spinner />
      </>
    );
  }

  if (!can("transport:read")) {
    return (
      <>
        <PageHeader title="Routes" subtitle="Routes & stops" />
        <EmptyState message="You do not have access to transport." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Routes"
        subtitle="Routes, vehicles & drivers"
        action={
          canCreate ? (
            <Button onClick={openCreate}>+ Add route</Button>
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
      ) : routes.length === 0 ? (
        <EmptyState message="No routes yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Route</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3">Stops</th>
                <th className="px-4 py-3">Students</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {routes.map((route) => (
                <tr key={route.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <Link
                      href={`/transport/routes/${route.id}`}
                      className="text-brand-600 hover:text-brand-700"
                    >
                      {route.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{route.code}</td>
                  <td className="px-4 py-3">{route.vehicleNo ?? "—"}</td>
                  <td className="px-4 py-3">{route.driverName ?? "—"}</td>
                  <td className="px-4 py-3">{route.stopCount}</td>
                  <td className="px-4 py-3">{route.studentCount}</td>
                  <td className="px-4 py-3">
                    <Badge tone={route.isActive ? "green" : "slate"}>
                      {route.isActive ? "active" : "inactive"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-3">
                      <Link
                        href={`/transport/routes/${route.id}`}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700"
                      >
                        Stops
                      </Link>
                      {canUpdate && (
                        <button
                          onClick={() => openEdit(route)}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          Edit
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => removeRoute(route)}
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

      <Modal
        title={editing ? "Edit route" : "Add route"}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" error={errors.name?.message}>
              <Input {...register("name")} />
            </Field>
            <Field label="Code" error={errors.code?.message}>
              <Input {...register("code")} />
            </Field>
          </div>
          <Field label="Vehicle" error={errors.vehicleId?.message}>
            <Select {...register("vehicleId")}>
              <option value="">— Unassigned —</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.registrationNo}
                  {vehicle.type ? ` (${vehicle.type})` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Driver" error={errors.driverId?.message}>
            <Select {...register("driverId")}>
              <option value="">— Unassigned —</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name}
                </option>
              ))}
            </Select>
          </Field>
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
              {isSubmitting ? "Saving…" : "Save route"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
