"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

const EVENT_TYPES = ["holiday", "event", "exam", "meeting", "other"] as const;
type EventType = (typeof EVENT_TYPES)[number];

interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  eventDate: string;
  endDate: string | null;
  type: EventType;
  allDay: boolean;
}

function typeTone(type: string): "green" | "amber" | "red" | "slate" | "blue" {
  switch (type) {
    case "holiday":
      return "red";
    case "exam":
      return "amber";
    case "meeting":
      return "blue";
    case "event":
      return "green";
    default:
      return "slate";
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

function monthRange(year: number, month0: number) {
  const start = `${year}-${pad(month0 + 1)}-01`;
  const lastDay = new Date(year, month0 + 1, 0).getDate();
  const end = `${year}-${pad(month0 + 1)}-${pad(lastDay)}`;
  const label = new Date(year, month0, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  return { start, end, label };
}

const eventSchema = z.object({
  title: z.string().min(1, "Required"),
  eventDate: z.string().min(1, "Required"),
  endDate: z.string().optional(),
  type: z.enum(EVENT_TYPES),
  description: z.string().optional(),
});
type EventForm = z.infer<typeof eventSchema>;

export default function CalendarPage() {
  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [typeFilter, setTypeFilter] = useState("");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const range = useMemo(() => monthRange(cursor.year, cursor.month), [cursor]);

  const load = useCallback(async () => {
    setLoading(true);
    setRowError(null);
    try {
      const params = new URLSearchParams({ dateFrom: range.start, dateTo: range.end });
      if (typeFilter) params.set("type", typeFilter);
      setEvents(await api.get<CalendarEvent[]>(`/calendar/events?${params.toString()}`));
    } finally {
      setLoading(false);
    }
  }, [range, typeFilter]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EventForm>({
    resolver: zodResolver(eventSchema),
    defaultValues: { type: "event" },
  });

  const onSubmit = async (values: EventForm) => {
    setServerError(null);
    try {
      await api.post("/calendar/events", { ...values, endDate: values.endDate || undefined });
      setModalOpen(false);
      reset({ type: "event" });
      await load();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Failed to save event");
    }
  };

  const removeEvent = async (event: CalendarEvent) => {
    if (!confirm(`Delete "${event.title}"?`)) return;
    setRowError(null);
    try {
      await api.delete(`/calendar/events/${event.id}`);
      await load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  };

  const prev = () =>
    setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }));
  const next = () =>
    setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }));

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Holidays, events, exams and meetings"
        action={<Button onClick={() => setModalOpen(true)}>+ Add event</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={prev}>
            ←
          </Button>
          <span className="min-w-[160px] text-center font-semibold text-ink">{range.label}</span>
          <Button variant="secondary" onClick={next}>
            →
          </Button>
        </div>
        <div className="w-44">
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <ErrorNote message={rowError} />

      {loading ? (
        <Spinner />
      ) : events.length === 0 ? (
        <EmptyState message="No events this month" />
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <div
              key={event.id}
              className="flex items-center gap-4 rounded-xl border border-line bg-surface px-4 py-3"
            >
              <div className="w-28 shrink-0 text-sm font-medium text-muted">
                {event.eventDate}
                {event.endDate && event.endDate !== event.eventDate && (
                  <span className="block text-xs text-faint">→ {event.endDate}</span>
                )}
              </div>
              <Badge tone={typeTone(event.type)}>{event.type}</Badge>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">{event.title}</p>
                {event.description && (
                  <p className="truncate text-xs text-muted">{event.description}</p>
                )}
              </div>
              <button
                onClick={() => removeEvent(event)}
                className="shrink-0 text-xs font-medium text-red-600 hover:text-red-700"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      <Modal title="Add event" open={modalOpen} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Title" error={errors.title?.message}>
            <Input placeholder="e.g. Annual Day" {...register("title")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" error={errors.eventDate?.message}>
              <Input type="date" {...register("eventDate")} />
            </Field>
            <Field label="End date (optional)">
              <Input type="date" {...register("endDate")} />
            </Field>
          </div>
          <Field label="Type">
            <Select {...register("type")}>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Description">
            <Input {...register("description")} />
          </Field>
          <ErrorNote message={serverError} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save event"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
