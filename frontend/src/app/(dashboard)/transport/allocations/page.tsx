"use client";

import { useCallback, useEffect, useState } from "react";
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
import type {
  Paginated,
  RouteStop,
  Student,
  TransportAllocation,
  TransportRoute,
} from "@/types";

const TRIP_TYPES = ["both", "pickup", "drop"] as const;
const STATUSES = ["active", "inactive"] as const;

function fmtDate(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

export default function AllocationsPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canAllocate = can("transport:allocate");

  const [routes, setRoutes] = useState<TransportRoute[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [routeFilter, setRouteFilter] = useState("");
  const [allocations, setAllocations] = useState<TransportAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TransportAllocation | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state.
  const [studentId, setStudentId] = useState("");
  const [routeId, setRouteId] = useState("");
  const [stopId, setStopId] = useState("");
  const [tripType, setTripType] = useState<string>("both");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [status, setStatus] = useState<string>("active");
  const [stops, setStops] = useState<RouteStop[]>([]);
  const [stopsLoading, setStopsLoading] = useState(false);

  const loadAllocations = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = routeFilter
        ? `?routeId=${encodeURIComponent(routeFilter)}`
        : "";
      setAllocations(
        await api.get<TransportAllocation[]>(`/transport/allocations${qs}`)
      );
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load allocations"
      );
    } finally {
      setLoading(false);
    }
  }, [routeFilter]);

  useEffect(() => {
    loadAllocations();
  }, [loadAllocations]);

  useEffect(() => {
    Promise.all([
      api.get<TransportRoute[]>("/transport/routes"),
      api.get<Paginated<Student>>("/students?limit=500"),
    ])
      .then(([routeList, studentResult]) => {
        setRoutes(routeList);
        setStudents(studentResult.data);
      })
      .catch(() => undefined);
  }, []);

  // Dependent stop dropdown — fetch stops when the form's route changes.
  useEffect(() => {
    if (!routeId) {
      setStops([]);
      return;
    }
    let active = true;
    setStopsLoading(true);
    api
      .get<RouteStop[]>(`/transport/routes/${routeId}/stops`)
      .then((list) => {
        if (active) setStops(list);
      })
      .catch(() => {
        if (active) setStops([]);
      })
      .finally(() => {
        if (active) setStopsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [routeId]);

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    setStudentId("");
    setRouteId("");
    setStopId("");
    setTripType("both");
    setEffectiveDate("");
    setStatus("active");
    setModalOpen(true);
  };

  const openEdit = (allocation: TransportAllocation) => {
    setEditing(allocation);
    setFormError(null);
    setStudentId(allocation.studentId);
    setRouteId(allocation.routeId);
    setStopId(allocation.stopId ?? "");
    setTripType(allocation.tripType || "both");
    setEffectiveDate(allocation.effectiveDate?.slice(0, 10) ?? "");
    setStatus(allocation.status || "active");
    setModalOpen(true);
  };

  const onSubmit = async () => {
    setFormError(null);
    if (!editing && !studentId) {
      setFormError("Select a student");
      return;
    }
    if (!routeId) {
      setFormError("Select a route");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/transport/allocations/${editing.id}`, {
          routeId,
          stopId: stopId || undefined,
          tripType,
          status,
        });
      } else {
        await api.post("/transport/allocations", {
          studentId,
          routeId,
          stopId: stopId || undefined,
          tripType,
          effectiveDate: effectiveDate || undefined,
          status,
        });
      }
      setModalOpen(false);
      await loadAllocations();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to save allocation"
      );
    } finally {
      setSaving(false);
    }
  };

  const removeAllocation = async (allocation: TransportAllocation) => {
    if (!confirm(`Remove ${allocation.studentName} from ${allocation.routeName}?`))
      return;
    try {
      await api.delete(`/transport/allocations/${allocation.id}`);
      await loadAllocations();
    } catch (err) {
      alert(
        err instanceof ApiError ? err.message : "Failed to delete allocation"
      );
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Allocations" subtitle="Student transport" />
        <Spinner />
      </>
    );
  }

  if (!can("transport:read")) {
    return (
      <>
        <PageHeader title="Allocations" subtitle="Student transport" />
        <EmptyState message="You do not have access to transport." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Allocations"
        subtitle="Assign students to routes & stops"
        action={
          canAllocate ? (
            <Button onClick={openCreate}>+ Allocate student</Button>
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

      <div className="mb-4 w-64">
        <span className="mb-1 block text-sm font-medium text-slate-700">
          Filter by route
        </span>
        <Select
          value={routeFilter}
          onChange={(event) => setRouteFilter(event.target.value)}
        >
          <option value="">All routes</option>
          {routes.map((route) => (
            <option key={route.id} value={route.id}>
              {route.name} ({route.code})
            </option>
          ))}
        </Select>
      </div>

      {loading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorNote message={loadError} />
      ) : allocations.length === 0 ? (
        <EmptyState message="No allocations found" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Route</th>
                <th className="px-4 py-3">Stop</th>
                <th className="px-4 py-3">Trip</th>
                <th className="px-4 py-3">Effective</th>
                <th className="px-4 py-3">Status</th>
                {canAllocate && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {allocations.map((allocation) => (
                <tr key={allocation.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {allocation.studentName}
                    <span className="block font-mono text-xs text-slate-400">
                      {allocation.admissionNo}
                    </span>
                  </td>
                  <td className="px-4 py-3">{allocation.routeName}</td>
                  <td className="px-4 py-3">{allocation.stopName ?? "—"}</td>
                  <td className="px-4 py-3">{allocation.tripType}</td>
                  <td className="px-4 py-3">
                    {fmtDate(allocation.effectiveDate)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      tone={allocation.status === "active" ? "green" : "slate"}
                    >
                      {allocation.status}
                    </Badge>
                  </td>
                  {canAllocate && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          onClick={() => openEdit(allocation)}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => removeAllocation(allocation)}
                          className="text-xs font-medium text-red-600 hover:text-red-700"
                        >
                          Delete
                        </button>
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
        title={editing ? "Edit allocation" : "Allocate student"}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <div className="space-y-4">
          <Field label="Student">
            {editing ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {editing.studentName} ({editing.admissionNo})
              </p>
            ) : (
              <Select
                value={studentId}
                onChange={(event) => setStudentId(event.target.value)}
              >
                <option value="">Select a student…</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.firstName} {student.lastName} ({student.admissionNo})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Route">
            <Select
              value={routeId}
              onChange={(event) => {
                setRouteId(event.target.value);
                setStopId("");
              }}
            >
              <option value="">Select a route…</option>
              {routes.map((route) => (
                <option key={route.id} value={route.id}>
                  {route.name} ({route.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Stop">
            <Select
              value={stopId}
              onChange={(event) => setStopId(event.target.value)}
              disabled={!routeId || stopsLoading}
            >
              <option value="">
                {stopsLoading ? "Loading stops…" : "— No specific stop —"}
              </option>
              {stops.map((stop) => (
                <option key={stop.id} value={stop.id}>
                  {stop.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Trip type">
              <Select
                value={tripType}
                onChange={(event) => setTripType(event.target.value)}
              >
                {TRIP_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status">
              <Select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                {STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {!editing && (
            <Field label="Effective date">
              <Input
                type="date"
                value={effectiveDate}
                onChange={(event) => setEffectiveDate(event.target.value)}
              />
            </Field>
          )}
          <ErrorNote message={formError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={onSubmit} disabled={saving}>
              {saving ? "Saving…" : "Save allocation"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
