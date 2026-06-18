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
  Hostel,
  HostelAllocation,
  HostelRoom,
  Paginated,
  Student,
} from "@/types";

const STATUSES = ["active", "vacated"] as const;

function fmtDate(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

function roomLabel(room: HostelRoom): string {
  const block = room.blockName ? `${room.blockName} · ` : "";
  return `${block}${room.roomNumber} (${room.availableBeds} free)`;
}

export default function HostelAllocationsPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canAllocate = can("hostel:allocate");

  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [hostelFilter, setHostelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [allocations, setAllocations] = useState<HostelAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Allocate modal state.
  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [hostelId, setHostelId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [bedNo, setBedNo] = useState("");
  const [allocationDate, setAllocationDate] = useState("");
  const [rooms, setRooms] = useState<HostelRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);

  // Transfer modal state.
  const [transferTarget, setTransferTarget] =
    useState<HostelAllocation | null>(null);
  const [transferRoomId, setTransferRoomId] = useState("");
  const [transferBedNo, setTransferBedNo] = useState("");
  const [transferRooms, setTransferRooms] = useState<HostelRoom[]>([]);
  const [transferRoomsLoading, setTransferRoomsLoading] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferring, setTransferring] = useState(false);

  const loadAllocations = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (hostelFilter) params.set("hostelId", hostelFilter);
      if (statusFilter) params.set("status", statusFilter);
      const qs = params.toString();
      setAllocations(
        await api.get<HostelAllocation[]>(
          `/hostel/allocations${qs ? `?${qs}` : ""}`
        )
      );
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load allocations"
      );
    } finally {
      setLoading(false);
    }
  }, [hostelFilter, statusFilter]);

  useEffect(() => {
    loadAllocations();
  }, [loadAllocations]);

  useEffect(() => {
    Promise.all([
      api.get<Hostel[]>("/hostel/hostels"),
      api.get<Paginated<Student>>("/students?limit=500"),
    ])
      .then(([hostelList, studentResult]) => {
        setHostels(hostelList);
        setStudents(studentResult.data);
      })
      .catch(() => undefined);
  }, []);

  // Dependent room dropdown for the allocate form.
  useEffect(() => {
    if (!hostelId) {
      setRooms([]);
      return;
    }
    let active = true;
    setRoomsLoading(true);
    api
      .get<HostelRoom[]>(`/hostel/hostels/${hostelId}/rooms`)
      .then((list) => {
        if (active) setRooms(list);
      })
      .catch(() => {
        if (active) setRooms([]);
      })
      .finally(() => {
        if (active) setRoomsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [hostelId]);

  // Dependent room dropdown for the transfer form (same hostel as allocation).
  useEffect(() => {
    if (!transferTarget) {
      setTransferRooms([]);
      return;
    }
    let active = true;
    setTransferRoomsLoading(true);
    api
      .get<HostelRoom[]>(`/hostel/hostels/${transferTarget.hostelId}/rooms`)
      .then((list) => {
        if (active) setTransferRooms(list);
      })
      .catch(() => {
        if (active) setTransferRooms([]);
      })
      .finally(() => {
        if (active) setTransferRoomsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [transferTarget]);

  const openCreate = () => {
    setFormError(null);
    setStudentId("");
    setHostelId("");
    setRoomId("");
    setBedNo("");
    setAllocationDate("");
    setModalOpen(true);
  };

  const onSubmit = async () => {
    setFormError(null);
    if (!studentId) {
      setFormError("Select a student");
      return;
    }
    if (!hostelId) {
      setFormError("Select a hostel");
      return;
    }
    if (!roomId) {
      setFormError("Select a room");
      return;
    }
    setSaving(true);
    try {
      await api.post("/hostel/allocations", {
        studentId,
        hostelId,
        roomId,
        bedNo: bedNo || undefined,
        allocationDate: allocationDate || undefined,
      });
      setModalOpen(false);
      await loadAllocations();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to allocate"
      );
    } finally {
      setSaving(false);
    }
  };

  const openTransfer = (allocation: HostelAllocation) => {
    setTransferTarget(allocation);
    setTransferRoomId("");
    setTransferBedNo("");
    setTransferError(null);
  };

  const onTransfer = async () => {
    if (!transferTarget) return;
    setTransferError(null);
    if (!transferRoomId) {
      setTransferError("Select a room");
      return;
    }
    setTransferring(true);
    try {
      await api.post(`/hostel/allocations/${transferTarget.id}/transfer`, {
        roomId: transferRoomId,
        bedNo: transferBedNo || undefined,
      });
      setTransferTarget(null);
      await loadAllocations();
    } catch (err) {
      setTransferError(
        err instanceof ApiError ? err.message : "Failed to transfer"
      );
    } finally {
      setTransferring(false);
    }
  };

  const vacate = async (allocation: HostelAllocation) => {
    if (!confirm(`Vacate ${allocation.studentName} from ${allocation.roomNumber}?`))
      return;
    try {
      await api.post(`/hostel/allocations/${allocation.id}/vacate`, {});
      await loadAllocations();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to vacate");
    }
  };

  const removeAllocation = async (allocation: HostelAllocation) => {
    if (
      !confirm(`Remove ${allocation.studentName} from ${allocation.hostelName}?`)
    )
      return;
    try {
      await api.delete(`/hostel/allocations/${allocation.id}`);
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
        <PageHeader title="Allocations" subtitle="Student hostel rooms" />
        <Spinner />
      </>
    );
  }

  if (!can("hostel:read")) {
    return (
      <>
        <PageHeader title="Allocations" subtitle="Student hostel rooms" />
        <EmptyState message="You do not have access to hostel." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Allocations"
        subtitle="Assign students to rooms & beds"
        action={
          canAllocate ? (
            <Button onClick={openCreate}>+ Allocate student</Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Link
          href="/hostel"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Hostel
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-64">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Filter by hostel
          </span>
          <Select
            value={hostelFilter}
            onChange={(event) => setHostelFilter(event.target.value)}
          >
            <option value="">All hostels</option>
            {hostels.map((hostel) => (
              <option key={hostel.id} value={hostel.id}>
                {hostel.name} ({hostel.code})
              </option>
            ))}
          </Select>
        </div>
        <div className="w-48">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Status
          </span>
          <Select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">All statuses</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </div>
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
                <th className="px-4 py-3">Hostel</th>
                <th className="px-4 py-3">Room</th>
                <th className="px-4 py-3">Bed</th>
                <th className="px-4 py-3">Allocated</th>
                <th className="px-4 py-3">Vacated</th>
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
                  <td className="px-4 py-3">{allocation.hostelName}</td>
                  <td className="px-4 py-3">{allocation.roomNumber}</td>
                  <td className="px-4 py-3">{allocation.bedNo ?? "—"}</td>
                  <td className="px-4 py-3">
                    {fmtDate(allocation.allocationDate)}
                  </td>
                  <td className="px-4 py-3">{fmtDate(allocation.vacateDate)}</td>
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
                        {allocation.status === "active" && (
                          <>
                            <button
                              onClick={() => openTransfer(allocation)}
                              className="text-xs font-medium text-brand-600 hover:text-brand-700"
                            >
                              Transfer
                            </button>
                            <button
                              onClick={() => vacate(allocation)}
                              className="text-xs font-medium text-amber-600 hover:text-amber-700"
                            >
                              Vacate
                            </button>
                          </>
                        )}
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
        title="Allocate student"
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <div className="space-y-4">
          <Field label="Student">
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
          </Field>
          <Field label="Hostel">
            <Select
              value={hostelId}
              onChange={(event) => {
                setHostelId(event.target.value);
                setRoomId("");
              }}
            >
              <option value="">Select a hostel…</option>
              {hostels.map((hostel) => (
                <option key={hostel.id} value={hostel.id}>
                  {hostel.name} ({hostel.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Room">
            <Select
              value={roomId}
              onChange={(event) => setRoomId(event.target.value)}
              disabled={!hostelId || roomsLoading}
            >
              <option value="">
                {roomsLoading ? "Loading rooms…" : "Select a room…"}
              </option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {roomLabel(room)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bed no (optional)">
              <Input
                value={bedNo}
                onChange={(event) => setBedNo(event.target.value)}
              />
            </Field>
            <Field label="Allocation date">
              <Input
                type="date"
                value={allocationDate}
                onChange={(event) => setAllocationDate(event.target.value)}
              />
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
            <Button type="button" onClick={onSubmit} disabled={saving}>
              {saving ? "Saving…" : "Allocate"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        title="Transfer student"
        open={transferTarget !== null}
        onClose={() => setTransferTarget(null)}
      >
        <div className="space-y-4">
          {transferTarget && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {transferTarget.studentName} ({transferTarget.admissionNo}) ·{" "}
              {transferTarget.hostelName} · {transferTarget.roomNumber}
            </p>
          )}
          <Field label="New room">
            <Select
              value={transferRoomId}
              onChange={(event) => setTransferRoomId(event.target.value)}
              disabled={transferRoomsLoading}
            >
              <option value="">
                {transferRoomsLoading ? "Loading rooms…" : "Select a room…"}
              </option>
              {transferRooms
                .filter((room) => room.id !== transferTarget?.roomId)
                .map((room) => (
                  <option key={room.id} value={room.id}>
                    {roomLabel(room)}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Bed no (optional)">
            <Input
              value={transferBedNo}
              onChange={(event) => setTransferBedNo(event.target.value)}
            />
          </Field>
          <ErrorNote message={transferError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setTransferTarget(null)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={onTransfer} disabled={transferring}>
              {transferring ? "Transferring…" : "Transfer"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
