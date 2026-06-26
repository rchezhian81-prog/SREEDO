"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
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
import { Icon } from "@/components/icons";
import { useAuthStore } from "@/stores/auth-store";
import { useTerms } from "@/lib/terms";
import type { LiveClass, LiveClassStatus } from "@/types";

const PROVIDER_LABELS: Record<string, string> = {
  meet: "Google Meet",
  zoom: "Zoom",
  teams: "MS Teams",
  jitsi: "Jitsi",
  other: "Other",
};

const STATUS_TONE: Record<LiveClassStatus, "blue" | "green" | "slate" | "red"> = {
  scheduled: "blue",
  live: "green",
  completed: "slate",
  cancelled: "red",
};

const schema = z.object({
  title: z.string().min(1, "Required"),
  subject: z.string().optional(),
  target: z.string().optional(),
  provider: z.enum(["meet", "zoom", "teams", "jitsi", "other"]),
  joinUrl: z.string().url("Enter a valid URL"),
  scheduledAt: z.string().min(1, "Required"),
  durationMin: z.coerce.number().int().min(5).max(600),
});

type FormValues = z.infer<typeof schema>;

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function LiveClassesPage() {
  const term = useTerms();
  const role = useAuthStore((s) => s.user?.role);
  const canManage = role === "admin" || role === "teacher";

  const [items, setItems] = useState<LiveClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.get<LiveClass[]>("/live-classes"));
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
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { provider: "meet", durationMin: 60 },
  });

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    try {
      await api.post("/live-classes", {
        ...values,
        subject: values.subject || undefined,
        target: values.target || undefined,
        scheduledAt: new Date(values.scheduledAt).toISOString(),
      });
      setModalOpen(false);
      reset({ provider: "meet", durationMin: 60 });
      await load();
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Failed to schedule live class"
      );
    }
  };

  const remove = async (item: LiveClass) => {
    if (!confirm(`Delete "${item.title}"?`)) return;
    await api.delete(`/live-classes/${item.id}`);
    await load();
  };

  return (
    <>
      <PageHeader
        title="Live Classes"
        subtitle="Scheduled virtual sessions with join links"
        action={
          canManage ? (
            <Button onClick={() => setModalOpen(true)}>+ Schedule class</Button>
          ) : undefined
        }
      />

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState message="No live classes scheduled" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">{term.subject}</th>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3 font-medium text-ink">
                    {item.title}
                    {item.target && (
                      <span className="block text-xs text-faint">{item.target}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{item.subject ?? "—"}</td>
                  <td className="px-4 py-3">
                    {formatWhen(item.scheduledAt)}
                    <span className="block text-xs text-faint">
                      {item.durationMin} min
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {PROVIDER_LABELS[item.provider] ?? item.provider}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      <a
                        href={item.joinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700"
                      >
                        <Icon name="video" className="h-3.5 w-3.5" />
                        Join
                      </a>
                      {canManage && (
                        <button
                          onClick={() => remove(item)}
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
        title="Schedule live class"
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Title" error={errors.title?.message}>
            <Input placeholder="Algebra revision" {...register("title")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={term.subject}>
              <Input placeholder="Mathematics" {...register("subject")} />
            </Field>
            <Field label="For">
              <Input
                placeholder={`${term.klass} / ${term.section}`}
                {...register("target")}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider">
              <Select {...register("provider")}>
                <option value="meet">Google Meet</option>
                <option value="zoom">Zoom</option>
                <option value="teams">MS Teams</option>
                <option value="jitsi">Jitsi</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            <Field label="Duration (min)" error={errors.durationMin?.message}>
              <Input type="number" min={5} max={600} {...register("durationMin")} />
            </Field>
          </div>
          <Field label="Join URL" error={errors.joinUrl?.message}>
            <Input placeholder="https://meet.google.com/abc-defg-hij" {...register("joinUrl")} />
          </Field>
          <Field label="Scheduled at" error={errors.scheduledAt?.message}>
            <Input type="datetime-local" {...register("scheduledAt")} />
          </Field>
          <ErrorNote message={serverError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Schedule"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
