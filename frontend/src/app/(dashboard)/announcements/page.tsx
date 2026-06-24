"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
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
  Textarea,
} from "@/components/ui";
import type { Announcement, Paginated } from "@/types";

const announcementSchema = z.object({
  title: z.string().min(1, "Required"),
  body: z.string().min(1, "Required"),
  audience: z.enum(["all", "teachers", "students", "parents", "staff"]),
  isPinned: z.boolean(),
  // datetime-local value (no timezone); converted to ISO on submit.
  publishAt: z.string().optional(),
});

type AnnouncementForm = z.infer<typeof announcementSchema>;

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<Paginated<Announcement>>(
        "/announcements?limit=50"
      );
      setAnnouncements(result.data);
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
  } = useForm<AnnouncementForm>({
    resolver: zodResolver(announcementSchema),
    defaultValues: { audience: "all", isPinned: false },
  });

  const onSubmit = async (values: AnnouncementForm) => {
    setServerError(null);
    try {
      const { publishAt, ...rest } = values;
      await api.post("/announcements", {
        ...rest,
        publishAt: publishAt ? new Date(publishAt).toISOString() : undefined,
      });
      setModalOpen(false);
      reset({ audience: "all", isPinned: false, publishAt: "" });
      await load();
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Failed to publish"
      );
    }
  };

  const remove = async (announcement: Announcement) => {
    if (!confirm(`Delete "${announcement.title}"?`)) return;
    await api.delete(`/announcements/${announcement.id}`);
    await load();
  };

  return (
    <>
      <PageHeader
        title="Announcements"
        subtitle="Notices for staff, students and parents"
        action={
          <Button onClick={() => setModalOpen(true)}>+ New announcement</Button>
        }
      />

      {loading ? (
        <Spinner />
      ) : announcements.length === 0 ? (
        <EmptyState message="Nothing on the notice board yet" />
      ) : (
        <div className="space-y-3">
          {announcements.map((announcement) => (
            <Card key={announcement.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-ink">
                      {announcement.title}
                    </h3>
                    {announcement.isPinned && (
                      <Badge tone="amber">Pinned</Badge>
                    )}
                    <Badge tone="blue">{announcement.audience}</Badge>
                    {announcement.scheduled && (
                      <Badge tone="slate">Scheduled</Badge>
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted">
                    {announcement.body}
                  </p>
                  <p className="mt-2 text-xs text-faint">
                    {announcement.scheduled ? "Scheduled for " : ""}
                    {new Date(announcement.publishedAt).toLocaleString()} ·{" "}
                    {announcement.createdByName ?? "System"}
                  </p>
                </div>
                <button
                  onClick={() => remove(announcement)}
                  className="shrink-0 text-xs font-medium text-red-600 hover:text-red-700"
                >
                  Delete
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        title="New announcement"
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Title" error={errors.title?.message}>
            <Input {...register("title")} />
          </Field>
          <Field label="Message" error={errors.body?.message}>
            <Textarea rows={5} {...register("body")} />
          </Field>
          <div className="grid grid-cols-2 items-end gap-3">
            <Field label="Audience">
              <Select {...register("audience")}>
                <option value="all">Everyone</option>
                <option value="teachers">Teachers</option>
                <option value="students">Students</option>
                <option value="parents">Parents</option>
                <option value="staff">Staff</option>
              </Select>
            </Field>
            <label className="flex items-center gap-2 pb-2 text-sm text-ink">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-line"
                {...register("isPinned")}
              />
              Pin to top
            </label>
          </div>
          <Field label="Schedule for (optional)">
            <Input type="datetime-local" {...register("publishAt")} />
          </Field>
          <p className="-mt-2 text-xs text-faint">
            Leave blank to publish now. Until the scheduled time, only
            admins and teachers can see it.
          </p>
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
              {isSubmitting ? "Publishing…" : "Publish"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
