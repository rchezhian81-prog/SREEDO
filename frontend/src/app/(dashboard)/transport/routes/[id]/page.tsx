"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { RouteStop, TransportRoute } from "@/types";

const stopSchema = z.object({
  name: z.string().min(1, "Required"),
  stopOrder: z.coerce.number().int().min(0).optional().or(z.literal("")),
  pickupTime: z.string().optional(),
  dropTime: z.string().optional(),
  distanceKm: z.coerce.number().min(0).optional().or(z.literal("")),
  zone: z.string().optional(),
});

type StopForm = z.infer<typeof stopSchema>;

function fmtTime(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 5);
}

export default function RouteStopsPage() {
  const params = useParams<{ id: string }>();
  const routeId = params.id;

  const { can, loading: permsLoading } = usePermissions();
  const canCreate = can("transport:create");
  const canUpdate = can("transport:update");
  const canDelete = can("transport:delete");

  const [route, setRoute] = useState<TransportRoute | null>(null);
  const [stops, setStops] = useState<RouteStop[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RouteStop | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [routeList, stopList] = await Promise.all([
        api.get<TransportRoute[]>("/transport/routes"),
        api.get<RouteStop[]>(`/transport/routes/${routeId}/stops`),
      ]);
      setRoute(routeList.find((item) => item.id === routeId) ?? null);
      setStops(stopList);
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load stops"
      );
    } finally {
      setLoading(false);
    }
  }, [routeId]);

  useEffect(() => {
    load();
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<StopForm>({ resolver: zodResolver(stopSchema) });

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    reset({
      name: "",
      stopOrder: stops.length + 1,
      pickupTime: "",
      dropTime: "",
      distanceKm: "",
      zone: "",
    });
    setModalOpen(true);
  };

  const openEdit = (stop: RouteStop) => {
    setEditing(stop);
    setFormError(null);
    reset({
      name: stop.name,
      stopOrder: stop.stopOrder ?? "",
      pickupTime: stop.pickupTime?.slice(0, 5) ?? "",
      dropTime: stop.dropTime?.slice(0, 5) ?? "",
      distanceKm: stop.distanceKm == null ? "" : Number(stop.distanceKm),
      zone: stop.zone ?? "",
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: StopForm) => {
    setFormError(null);
    const body: Record<string, unknown> = {
      name: values.name,
      stopOrder: values.stopOrder === "" ? undefined : values.stopOrder,
      pickupTime: values.pickupTime || undefined,
      dropTime: values.dropTime || undefined,
      distanceKm: values.distanceKm === "" ? undefined : values.distanceKm,
      zone: values.zone || undefined,
    };
    try {
      if (editing) {
        await api.patch(`/transport/stops/${editing.id}`, body);
      } else {
        await api.post(`/transport/routes/${routeId}/stops`, body);
      }
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to save stop"
      );
    }
  };

  const removeStop = async (stop: RouteStop) => {
    if (!confirm(`Delete stop ${stop.name}?`)) return;
    try {
      await api.delete(`/transport/stops/${stop.id}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete stop");
    }
  };

  if (permsLoading || loading) {
    return (
      <>
        <PageHeader title="Route stops" />
        <Spinner />
      </>
    );
  }

  if (!can("transport:read")) {
    return (
      <>
        <PageHeader title="Route stops" />
        <EmptyState message="You do not have access to transport." />
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <PageHeader title="Route stops" />
        <div className="mb-4">
          <Link
            href="/transport/routes"
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            ← Back to Routes
          </Link>
        </div>
        <ErrorNote message={loadError} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={route ? `${route.name} · stops` : "Route stops"}
        subtitle={route ? `Code ${route.code}` : undefined}
        action={
          canCreate ? (
            <Button onClick={openCreate}>+ Add stop</Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Link
          href="/transport/routes"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Routes
        </Link>
      </div>

      {route && (
        <Card className="mb-6">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div>
              <dt className="text-slate-500">Vehicle</dt>
              <dd className="font-medium text-slate-900">
                {route.vehicleNo ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Driver</dt>
              <dd className="font-medium text-slate-900">
                {route.driverName ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Stops</dt>
              <dd className="font-medium text-slate-900">{route.stopCount}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Students</dt>
              <dd className="font-medium text-slate-900">
                {route.studentCount}
              </dd>
            </div>
          </dl>
        </Card>
      )}

      {stops.length === 0 ? (
        <EmptyState message="No stops yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Pickup</th>
                <th className="px-4 py-3">Drop</th>
                <th className="px-4 py-3">Zone</th>
                <th className="px-4 py-3">Distance (km)</th>
                {(canUpdate || canDelete) && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stops.map((stop) => (
                <tr key={stop.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">{stop.stopOrder}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {stop.name}
                  </td>
                  <td className="px-4 py-3">{fmtTime(stop.pickupTime)}</td>
                  <td className="px-4 py-3">{fmtTime(stop.dropTime)}</td>
                  <td className="px-4 py-3">{stop.zone ?? "—"}</td>
                  <td className="px-4 py-3">
                    {stop.distanceKm == null ? "—" : stop.distanceKm}
                  </td>
                  {(canUpdate || canDelete) && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        {canUpdate && (
                          <button
                            onClick={() => openEdit(stop)}
                            className="text-xs font-medium text-brand-600 hover:text-brand-700"
                          >
                            Edit
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => removeStop(stop)}
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
        title={editing ? "Edit stop" : "Add stop"}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" error={errors.name?.message}>
              <Input {...register("name")} />
            </Field>
            <Field label="Stop order" error={errors.stopOrder?.message}>
              <Input type="number" min={0} {...register("stopOrder")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pickup time" error={errors.pickupTime?.message}>
              <Input type="time" {...register("pickupTime")} />
            </Field>
            <Field label="Drop time" error={errors.dropTime?.message}>
              <Input type="time" {...register("dropTime")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Distance (km)" error={errors.distanceKm?.message}>
              <Input type="number" step="0.1" min={0} {...register("distanceKm")} />
            </Field>
            <Field label="Zone" error={errors.zone?.message}>
              <Input {...register("zone")} />
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
              {isSubmitting ? "Saving…" : "Save stop"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
