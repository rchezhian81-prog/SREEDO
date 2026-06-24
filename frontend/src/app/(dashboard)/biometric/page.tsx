"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import {
  Button,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { Paginated } from "@/types";

interface Device {
  id: string;
  name: string;
  deviceKey: string;
  location: string | null;
  isActive: boolean;
}

interface ScanEvent {
  id: string;
  identifier: string;
  eventType: "in" | "out";
  eventTime: string;
  deviceName: string;
  studentName: string | null;
}

const deviceSchema = z.object({
  name: z.string().min(1, "Required"),
  location: z.string().optional(),
});
type DeviceForm = z.infer<typeof deviceSchema>;

export default function BiometricPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setRowError(null);
    try {
      const [d, e] = await Promise.all([
        api.get<Device[]>("/biometric/devices"),
        api.get<Paginated<ScanEvent>>("/biometric/events?limit=20"),
      ]);
      setDevices(d);
      setEvents(e.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DeviceForm>({ resolver: zodResolver(deviceSchema) });

  const onSubmit = async (values: DeviceForm) => {
    setServerError(null);
    try {
      await api.post("/biometric/devices", values);
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Failed to save");
    }
  };

  const toggleActive = async (d: Device) => {
    setRowError(null);
    try {
      await api.patch(`/biometric/devices/${d.id}`, { isActive: !d.isActive });
      await load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Failed to update");
    }
  };

  const removeDevice = async (d: Device) => {
    if (!confirm(`Delete device "${d.name}"? Its scan history is removed too.`)) return;
    setRowError(null);
    try {
      await api.delete(`/biometric/devices/${d.id}`);
      await load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  };

  return (
    <>
      <PageHeader
        title="Biometric / RFID"
        subtitle="Attendance devices and scan log"
        action={<Button onClick={() => setModalOpen(true)}>+ Register device</Button>}
      />

      <ErrorNote message={rowError} />

      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Devices</h2>
            {devices.length === 0 ? (
              <EmptyState message="No devices registered" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                    <tr>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Location</th>
                      <th className="px-4 py-3">Device key</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {devices.map((d) => (
                      <tr key={d.id} className="hover:bg-surface-2">
                        <td className="px-4 py-3 font-medium text-ink">{d.name}</td>
                        <td className="px-4 py-3 text-muted">{d.location ?? "—"}</td>
                        <td className="px-4 py-3">
                          <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted">
                            {d.deviceKey}
                          </code>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={
                              d.isActive
                                ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700"
                                : "rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted"
                            }
                          >
                            {d.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-3">
                            <button
                              onClick={() => toggleActive(d)}
                              className="text-xs font-medium text-brand-600 hover:underline"
                            >
                              {d.isActive ? "Deactivate" : "Activate"}
                            </button>
                            <button
                              onClick={() => removeDevice(d)}
                              className="text-xs font-medium text-red-600 hover:text-red-700"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Recent scans</h2>
            {events.length === 0 ? (
              <EmptyState message="No scans recorded yet" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                    <tr>
                      <th className="px-4 py-3">Time</th>
                      <th className="px-4 py-3">Device</th>
                      <th className="px-4 py-3">Identifier</th>
                      <th className="px-4 py-3">Student</th>
                      <th className="px-4 py-3">Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {events.map((e) => (
                      <tr key={e.id} className="hover:bg-surface-2">
                        <td className="whitespace-nowrap px-4 py-3 text-muted">
                          {new Date(e.eventTime).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-muted">{e.deviceName}</td>
                        <td className="px-4 py-3 text-muted">{e.identifier}</td>
                        <td className="px-4 py-3 text-ink">{e.studentName ?? "— unmatched —"}</td>
                        <td className="px-4 py-3 capitalize text-muted">{e.eventType}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      <Modal title="Register device" open={modalOpen} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <p className="text-sm text-muted">
            A unique device key is generated on save — configure your device to send it in the{" "}
            <code className="text-xs">x-device-key</code> header.
          </p>
          <Field label="Name" error={errors.name?.message}>
            <Input placeholder="e.g. Main Gate Scanner" {...register("name")} />
          </Field>
          <Field label="Location">
            <Input placeholder="e.g. Entrance" {...register("location")} />
          </Field>
          <ErrorNote message={serverError} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Register"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
