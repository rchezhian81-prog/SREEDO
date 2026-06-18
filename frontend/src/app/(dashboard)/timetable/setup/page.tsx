"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import {
  Badge,
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
import type { Period, Room } from "@/types";

const periodSchema = z.object({
  name: z.string().min(1, "Required"),
  startTime: z.string().min(1, "Required"),
  endTime: z.string().min(1, "Required"),
  sortOrder: z.coerce.number().int().min(0),
  isBreak: z.boolean().optional(),
});
type PeriodForm = z.infer<typeof periodSchema>;

const roomSchema = z.object({
  name: z.string().min(1, "Required"),
  code: z.string().min(1, "Required"),
  capacity: z
    .union([z.coerce.number().int().min(0), z.literal("")])
    .optional(),
  building: z.string().optional(),
});
type RoomForm = z.infer<typeof roomSchema>;

const hhmm = (value: string) => value.slice(0, 5);

export default function TimetableSetupPage() {
  const role = useAuthStore((state) => state.user?.role);
  const isAdmin = role === "admin";

  const [periods, setPeriods] = useState<Period[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);

  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<Period | null>(null);
  const [periodError, setPeriodError] = useState<string | null>(null);

  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, r] = await Promise.all([
        api.get<Period[]>("/timetable/periods"),
        api.get<Room[]>("/timetable/rooms"),
      ]);
      setPeriods([...p].sort((a, b) => a.sortOrder - b.sortOrder));
      setRooms(r);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    load().catch(() => setLoading(false));
  }, [isAdmin, load]);

  const periodForm = useForm<PeriodForm>({
    resolver: zodResolver(periodSchema),
  });
  const roomForm = useForm<RoomForm>({ resolver: zodResolver(roomSchema) });

  const openAddPeriod = () => {
    setEditingPeriod(null);
    setPeriodError(null);
    periodForm.reset({
      name: "",
      startTime: "",
      endTime: "",
      sortOrder: periods.length,
      isBreak: false,
    });
    setPeriodModalOpen(true);
  };

  const openEditPeriod = (period: Period) => {
    setEditingPeriod(period);
    setPeriodError(null);
    periodForm.reset({
      name: period.name,
      startTime: hhmm(period.startTime),
      endTime: hhmm(period.endTime),
      sortOrder: period.sortOrder,
      isBreak: period.isBreak,
    });
    setPeriodModalOpen(true);
  };

  const submitPeriod = async (values: PeriodForm) => {
    setPeriodError(null);
    const body = {
      name: values.name,
      startTime: values.startTime,
      endTime: values.endTime,
      sortOrder: values.sortOrder,
      isBreak: values.isBreak ?? false,
    };
    try {
      if (editingPeriod) {
        await api.patch(`/timetable/periods/${editingPeriod.id}`, body);
      } else {
        await api.post("/timetable/periods", body);
      }
      setPeriodModalOpen(false);
      await load();
    } catch (err) {
      setPeriodError(
        err instanceof ApiError ? err.message : "Failed to save period"
      );
    }
  };

  const removePeriod = async (period: Period) => {
    if (!confirm(`Delete period "${period.name}"?`)) return;
    try {
      await api.delete(`/timetable/periods/${period.id}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete period");
    }
  };

  const openAddRoom = () => {
    setEditingRoom(null);
    setRoomError(null);
    roomForm.reset({ name: "", code: "", capacity: "", building: "" });
    setRoomModalOpen(true);
  };

  const openEditRoom = (room: Room) => {
    setEditingRoom(room);
    setRoomError(null);
    roomForm.reset({
      name: room.name,
      code: room.code,
      capacity: room.capacity ?? "",
      building: room.building ?? "",
    });
    setRoomModalOpen(true);
  };

  const submitRoom = async (values: RoomForm) => {
    setRoomError(null);
    const body = {
      name: values.name,
      code: values.code,
      capacity:
        values.capacity === "" || values.capacity === undefined
          ? undefined
          : values.capacity,
      building: values.building || undefined,
    };
    try {
      if (editingRoom) {
        await api.patch(`/timetable/rooms/${editingRoom.id}`, body);
      } else {
        await api.post("/timetable/rooms", body);
      }
      setRoomModalOpen(false);
      await load();
    } catch (err) {
      setRoomError(
        err instanceof ApiError ? err.message : "Failed to save room"
      );
    }
  };

  const removeRoom = async (room: Room) => {
    if (!confirm(`Delete room "${room.name}"?`)) return;
    try {
      await api.delete(`/timetable/rooms/${room.id}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete room");
    }
  };

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Timetable setup" subtitle="Periods & rooms" />
        <EmptyState message="Admins only" />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Timetable setup" subtitle="Periods & rooms" />

      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Periods</h2>
              <Button onClick={openAddPeriod}>+ Add period</Button>
            </div>
            {periods.length === 0 ? (
              <EmptyState message="No periods yet — add the first bell" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Time</th>
                      <th className="px-4 py-3">Order</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {periods.map((period) => (
                      <tr key={period.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {period.name}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {hhmm(period.startTime)} – {hhmm(period.endTime)}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {period.sortOrder}
                        </td>
                        <td className="px-4 py-3">
                          {period.isBreak ? (
                            <Badge tone="amber">Break</Badge>
                          ) : (
                            <Badge tone="slate">Class</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => openEditPeriod(period)}
                            className="text-xs font-medium text-brand-600 hover:text-brand-700"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => removePeriod(period)}
                            className="ml-3 text-xs font-medium text-red-600 hover:text-red-700"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Rooms</h2>
              <Button onClick={openAddRoom}>+ Add room</Button>
            </div>
            {rooms.length === 0 ? (
              <EmptyState message="No rooms yet — add the first room" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Code</th>
                      <th className="px-4 py-3">Capacity</th>
                      <th className="px-4 py-3">Building</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rooms.map((room) => (
                      <tr key={room.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {room.name}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {room.code}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {room.capacity ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {room.building ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => openEditRoom(room)}
                            className="text-xs font-medium text-brand-600 hover:text-brand-700"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => removeRoom(room)}
                            className="ml-3 text-xs font-medium text-red-600 hover:text-red-700"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      <Modal
        title={editingPeriod ? "Edit period" : "Add period"}
        open={periodModalOpen}
        onClose={() => setPeriodModalOpen(false)}
      >
        <form
          onSubmit={periodForm.handleSubmit(submitPeriod)}
          className="space-y-4"
        >
          <Field label="Name" error={periodForm.formState.errors.name?.message}>
            <Input placeholder="Period 1" {...periodForm.register("name")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Start time"
              error={periodForm.formState.errors.startTime?.message}
            >
              <Input type="time" {...periodForm.register("startTime")} />
            </Field>
            <Field
              label="End time"
              error={periodForm.formState.errors.endTime?.message}
            >
              <Input type="time" {...periodForm.register("endTime")} />
            </Field>
          </div>
          <Field
            label="Sort order"
            error={periodForm.formState.errors.sortOrder?.message}
          >
            <Input
              type="number"
              min={0}
              {...periodForm.register("sortOrder")}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
              {...periodForm.register("isBreak")}
            />
            This is a break (e.g. lunch, recess)
          </label>
          <ErrorNote message={periodError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPeriodModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={periodForm.formState.isSubmitting}>
              {periodForm.formState.isSubmitting
                ? "Saving…"
                : editingPeriod
                  ? "Save changes"
                  : "Add period"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        title={editingRoom ? "Edit room" : "Add room"}
        open={roomModalOpen}
        onClose={() => setRoomModalOpen(false)}
      >
        <form onSubmit={roomForm.handleSubmit(submitRoom)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" error={roomForm.formState.errors.name?.message}>
              <Input placeholder="Room 101" {...roomForm.register("name")} />
            </Field>
            <Field label="Code" error={roomForm.formState.errors.code?.message}>
              <Input placeholder="R101" {...roomForm.register("code")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Capacity"
              error={roomForm.formState.errors.capacity?.message}
            >
              <Input type="number" min={0} {...roomForm.register("capacity")} />
            </Field>
            <Field label="Building">
              <Input placeholder="Main block" {...roomForm.register("building")} />
            </Field>
          </div>
          <ErrorNote message={roomError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRoomModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={roomForm.formState.isSubmitting}>
              {roomForm.formState.isSubmitting
                ? "Saving…"
                : editingRoom
                  ? "Save changes"
                  : "Add room"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
