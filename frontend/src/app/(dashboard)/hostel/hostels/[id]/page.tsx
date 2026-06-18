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
  Badge,
  Button,
  Card,
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
  HostelBlock,
  HostelRoom,
  HostelRoomStatus,
} from "@/types";

const ROOM_STATUSES = [
  "available",
  "occupied",
  "maintenance",
  "inactive",
] as const;

const roomSchema = z.object({
  roomNumber: z.string().min(1, "Required"),
  blockId: z.string().optional(),
  floor: z.string().optional(),
  roomType: z.string().optional(),
  capacity: z.coerce.number().int().min(0).optional().or(z.literal("")),
  status: z.enum(ROOM_STATUSES).optional(),
});

type RoomForm = z.infer<typeof roomSchema>;

function statusBadge(status: string) {
  const tone =
    status === "available"
      ? "green"
      : status === "occupied"
        ? "blue"
        : status === "maintenance"
          ? "amber"
          : "slate";
  return <Badge tone={tone}>{status}</Badge>;
}

export default function HostelRoomsPage() {
  const params = useParams<{ id: string }>();
  const hostelId = params.id;

  const { can, loading: permsLoading } = usePermissions();
  const canCreate = can("hostel:create");
  const canUpdate = can("hostel:update");
  const canDelete = can("hostel:delete");

  const [hostel, setHostel] = useState<Hostel | null>(null);
  const [blocks, setBlocks] = useState<HostelBlock[]>([]);
  const [rooms, setRooms] = useState<HostelRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Block manager state.
  const [blockName, setBlockName] = useState("");
  const [blockError, setBlockError] = useState<string | null>(null);
  const [savingBlock, setSavingBlock] = useState(false);

  // Room modal state.
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<HostelRoom | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [hostelList, blockList, roomList] = await Promise.all([
        api.get<Hostel[]>("/hostel/hostels"),
        api.get<HostelBlock[]>(`/hostel/hostels/${hostelId}/blocks`),
        api.get<HostelRoom[]>(`/hostel/hostels/${hostelId}/rooms`),
      ]);
      setHostel(hostelList.find((item) => item.id === hostelId) ?? null);
      setBlocks(blockList);
      setRooms(roomList);
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load hostel"
      );
    } finally {
      setLoading(false);
    }
  }, [hostelId]);

  useEffect(() => {
    load();
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RoomForm>({ resolver: zodResolver(roomSchema) });

  const addBlock = async () => {
    setBlockError(null);
    if (!blockName.trim()) {
      setBlockError("Enter a block name");
      return;
    }
    setSavingBlock(true);
    try {
      await api.post(`/hostel/hostels/${hostelId}/blocks`, {
        name: blockName.trim(),
      });
      setBlockName("");
      await load();
    } catch (err) {
      setBlockError(
        err instanceof ApiError ? err.message : "Failed to add block"
      );
    } finally {
      setSavingBlock(false);
    }
  };

  const removeBlock = async (block: HostelBlock) => {
    if (!confirm(`Delete block ${block.name}?`)) return;
    try {
      await api.delete(`/hostel/blocks/${block.id}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete block");
    }
  };

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    reset({
      roomNumber: "",
      blockId: "",
      floor: "",
      roomType: "",
      capacity: "",
      status: "available",
    });
    setModalOpen(true);
  };

  const openEdit = (room: HostelRoom) => {
    setEditing(room);
    setFormError(null);
    reset({
      roomNumber: room.roomNumber,
      blockId: room.blockId ?? "",
      floor: room.floor ?? "",
      roomType: room.roomType ?? "",
      capacity: room.capacity ?? "",
      status: (ROOM_STATUSES as readonly string[]).includes(room.status)
        ? (room.status as HostelRoomStatus)
        : "available",
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: RoomForm) => {
    setFormError(null);
    const body: Record<string, unknown> = {
      roomNumber: values.roomNumber,
      blockId: values.blockId || undefined,
      floor: values.floor || undefined,
      roomType: values.roomType || undefined,
      capacity: values.capacity === "" ? undefined : values.capacity,
      status: values.status || undefined,
    };
    try {
      if (editing) {
        await api.patch(`/hostel/rooms/${editing.id}`, body);
      } else {
        await api.post(`/hostel/hostels/${hostelId}/rooms`, body);
      }
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to save room"
      );
    }
  };

  const removeRoom = async (room: HostelRoom) => {
    if (!confirm(`Delete room ${room.roomNumber}?`)) return;
    try {
      await api.delete(`/hostel/rooms/${room.id}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete room");
    }
  };

  if (permsLoading || loading) {
    return (
      <>
        <PageHeader title="Blocks & rooms" />
        <Spinner />
      </>
    );
  }

  if (!can("hostel:read")) {
    return (
      <>
        <PageHeader title="Blocks & rooms" />
        <EmptyState message="You do not have access to hostel." />
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <PageHeader title="Blocks & rooms" />
        <div className="mb-4">
          <Link
            href="/hostel/hostels"
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            ← Back to Hostels
          </Link>
        </div>
        <ErrorNote message={loadError} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={hostel ? `${hostel.name} · rooms` : "Blocks & rooms"}
        subtitle={hostel ? `Code ${hostel.code}` : undefined}
        action={
          canCreate ? (
            <Button onClick={openCreate}>+ Add room</Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Link
          href="/hostel/hostels"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Hostels
        </Link>
      </div>

      {hostel && (
        <Card className="mb-6">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div>
              <dt className="text-slate-500">Warden</dt>
              <dd className="font-medium text-slate-900">
                {hostel.wardenName ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Rooms</dt>
              <dd className="font-medium text-slate-900">{hostel.roomCount}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Beds</dt>
              <dd className="font-medium text-slate-900">{hostel.bedCount}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Occupied</dt>
              <dd className="font-medium text-slate-900">{hostel.occupied}</dd>
            </div>
          </dl>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <Card className="h-fit">
          <h2 className="text-sm font-semibold text-slate-900">Blocks</h2>
          <p className="mt-1 text-sm text-slate-500">
            Group rooms into blocks or wings.
          </p>
          <div className="mt-4 space-y-2">
            {blocks.length === 0 ? (
              <p className="text-sm text-slate-400">No blocks yet</p>
            ) : (
              blocks.map((block) => (
                <div
                  key={block.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
                >
                  <span className="text-sm font-medium text-slate-900">
                    {block.name}
                  </span>
                  {canDelete && (
                    <button
                      onClick={() => removeBlock(block)}
                      className="text-xs font-medium text-red-600 hover:text-red-700"
                    >
                      Delete
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
          {canCreate && (
            <div className="mt-4 space-y-2">
              <Field label="New block">
                <Input
                  value={blockName}
                  placeholder="e.g. Block A"
                  onChange={(event) => setBlockName(event.target.value)}
                />
              </Field>
              <ErrorNote message={blockError} />
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={addBlock}
                disabled={savingBlock}
              >
                {savingBlock ? "Adding…" : "Add block"}
              </Button>
            </div>
          )}
        </Card>

        <div>
          {rooms.length === 0 ? (
            <EmptyState message="No rooms yet" />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Room</th>
                    <th className="px-4 py-3">Block</th>
                    <th className="px-4 py-3">Floor</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Capacity</th>
                    <th className="px-4 py-3">Occupied</th>
                    <th className="px-4 py-3">Available</th>
                    <th className="px-4 py-3">Status</th>
                    {(canUpdate || canDelete) && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rooms.map((room) => (
                    <tr key={room.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {room.roomNumber}
                      </td>
                      <td className="px-4 py-3">{room.blockName ?? "—"}</td>
                      <td className="px-4 py-3">{room.floor ?? "—"}</td>
                      <td className="px-4 py-3">{room.roomType ?? "—"}</td>
                      <td className="px-4 py-3">{room.capacity}</td>
                      <td className="px-4 py-3">{room.occupied}</td>
                      <td className="px-4 py-3">{room.availableBeds}</td>
                      <td className="px-4 py-3">{statusBadge(room.status)}</td>
                      {(canUpdate || canDelete) && (
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-3">
                            {canUpdate && (
                              <button
                                onClick={() => openEdit(room)}
                                className="text-xs font-medium text-brand-600 hover:text-brand-700"
                              >
                                Edit
                              </button>
                            )}
                            {canDelete && (
                              <button
                                onClick={() => removeRoom(room)}
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
        </div>
      </div>

      <Modal
        title={editing ? "Edit room" : "Add room"}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Room number" error={errors.roomNumber?.message}>
              <Input {...register("roomNumber")} />
            </Field>
            <Field label="Block" error={errors.blockId?.message}>
              <Select {...register("blockId")}>
                <option value="">— No block —</option>
                {blocks.map((block) => (
                  <option key={block.id} value={block.id}>
                    {block.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Floor" error={errors.floor?.message}>
              <Input {...register("floor")} />
            </Field>
            <Field label="Room type" error={errors.roomType?.message}>
              <Input placeholder="e.g. single, double" {...register("roomType")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Capacity (beds)" error={errors.capacity?.message}>
              <Input type="number" min={0} {...register("capacity")} />
            </Field>
            <Field label="Status" error={errors.status?.message}>
              <Select {...register("status")}>
                {ROOM_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
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
              {isSubmitting ? "Saving…" : "Save room"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
