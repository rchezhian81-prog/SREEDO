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
import type { Hostel, HostelType } from "@/types";

const HOSTEL_TYPES = ["boys", "girls", "co_ed", "staff"] as const;

const hostelSchema = z.object({
  name: z.string().min(1, "Required"),
  code: z.string().min(1, "Required"),
  type: z.enum(HOSTEL_TYPES).optional(),
  address: z.string().optional(),
  wardenName: z.string().optional(),
  wardenPhone: z.string().optional(),
  contactPhone: z.string().optional(),
  capacity: z.coerce.number().int().min(0).optional().or(z.literal("")),
});

type HostelForm = z.infer<typeof hostelSchema>;

const TYPE_LABELS: Record<string, string> = {
  boys: "Boys",
  girls: "Girls",
  co_ed: "Co-ed",
  staff: "Staff",
};

function typeBadge(type: string | null | undefined) {
  if (!type) return <span className="text-slate-400">—</span>;
  const tone = type === "girls" ? "blue" : type === "staff" ? "slate" : "green";
  return <Badge tone={tone}>{TYPE_LABELS[type] ?? type}</Badge>;
}

export default function HostelsPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canCreate = can("hostel:create");
  const canUpdate = can("hostel:update");
  const canDelete = can("hostel:delete");

  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Hostel | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setHostels(await api.get<Hostel[]>("/hostel/hostels"));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load hostels"
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
  } = useForm<HostelForm>({ resolver: zodResolver(hostelSchema) });

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    reset({
      name: "",
      code: "",
      type: "boys",
      address: "",
      wardenName: "",
      wardenPhone: "",
      contactPhone: "",
      capacity: "",
    });
    setModalOpen(true);
  };

  const openEdit = (hostel: Hostel) => {
    setEditing(hostel);
    setFormError(null);
    reset({
      name: hostel.name,
      code: hostel.code,
      type: (HOSTEL_TYPES as readonly string[]).includes(hostel.type ?? "")
        ? (hostel.type as HostelType)
        : "boys",
      address: hostel.address ?? "",
      wardenName: hostel.wardenName ?? "",
      wardenPhone: hostel.wardenPhone ?? "",
      contactPhone: hostel.contactPhone ?? "",
      capacity: hostel.capacity ?? "",
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: HostelForm) => {
    setFormError(null);
    const body: Record<string, unknown> = {
      name: values.name,
      code: values.code,
      type: values.type || undefined,
      address: values.address || undefined,
      wardenName: values.wardenName || undefined,
      wardenPhone: values.wardenPhone || undefined,
      contactPhone: values.contactPhone || undefined,
      capacity: values.capacity === "" ? undefined : values.capacity,
    };
    try {
      if (editing) {
        await api.patch(`/hostel/hostels/${editing.id}`, body);
      } else {
        await api.post("/hostel/hostels", body);
      }
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to save hostel"
      );
    }
  };

  const removeHostel = async (hostel: Hostel) => {
    if (!confirm(`Delete hostel ${hostel.name}?`)) return;
    try {
      await api.delete(`/hostel/hostels/${hostel.id}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete hostel");
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Hostels" subtitle="Buildings & wardens" />
        <Spinner />
      </>
    );
  }

  if (!can("hostel:read")) {
    return (
      <>
        <PageHeader title="Hostels" subtitle="Buildings & wardens" />
        <EmptyState message="You do not have access to hostel." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Hostels"
        subtitle="Buildings, wardens & capacity"
        action={
          canCreate ? (
            <Button onClick={openCreate}>+ Add hostel</Button>
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

      {loading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorNote message={loadError} />
      ) : hostels.length === 0 ? (
        <EmptyState message="No hostels yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Hostel</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Warden</th>
                <th className="px-4 py-3">Rooms</th>
                <th className="px-4 py-3">Beds</th>
                <th className="px-4 py-3">Occupied</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {hostels.map((hostel) => (
                <tr key={hostel.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <Link
                      href={`/hostel/hostels/${hostel.id}`}
                      className="text-brand-600 hover:text-brand-700"
                    >
                      {hostel.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{hostel.code}</td>
                  <td className="px-4 py-3">{typeBadge(hostel.type)}</td>
                  <td className="px-4 py-3">
                    {hostel.wardenName ?? "—"}
                    {hostel.wardenPhone ? (
                      <span className="block text-xs text-slate-400">
                        {hostel.wardenPhone}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{hostel.roomCount}</td>
                  <td className="px-4 py-3">{hostel.bedCount}</td>
                  <td className="px-4 py-3">{hostel.occupied}</td>
                  <td className="px-4 py-3">
                    <Badge tone={hostel.isActive ? "green" : "slate"}>
                      {hostel.isActive ? "active" : "inactive"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-3">
                      <Link
                        href={`/hostel/hostels/${hostel.id}`}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700"
                      >
                        Rooms
                      </Link>
                      {canUpdate && (
                        <button
                          onClick={() => openEdit(hostel)}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          Edit
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => removeHostel(hostel)}
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
        title={editing ? "Edit hostel" : "Add hostel"}
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
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type" error={errors.type?.message}>
              <Select {...register("type")}>
                {HOSTEL_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABELS[type]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Capacity" error={errors.capacity?.message}>
              <Input type="number" min={0} {...register("capacity")} />
            </Field>
          </div>
          <Field label="Address" error={errors.address?.message}>
            <Input {...register("address")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Warden name" error={errors.wardenName?.message}>
              <Input {...register("wardenName")} />
            </Field>
            <Field label="Warden phone" error={errors.wardenPhone?.message}>
              <Input {...register("wardenPhone")} />
            </Field>
          </div>
          <Field label="Contact phone" error={errors.contactPhone?.message}>
            <Input {...register("contactPhone")} />
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
              {isSubmitting ? "Saving…" : "Save hostel"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
