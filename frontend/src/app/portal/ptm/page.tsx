"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { portalApi } from "@/lib/portal-api";
import { ApiError } from "@/lib/api";
import { usePortalStore } from "@/stores/portal-store";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  Field,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type {
  PortalPtmBooking,
  PortalPtmData,
  PortalPtmMeeting,
  PortalPtmSlot,
} from "@/types";
import { useI18n } from "@/i18n/I18nProvider";
import {
  activeBookingsFor,
  hasActiveBooking,
  isSlotBookable,
  slotsLeft,
} from "./helpers";

const formatDate = (value: string) => new Date(value).toLocaleDateString();
const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const formatWhen = (startsAt: string, endsAt: string) =>
  `${formatDate(startsAt)} · ${formatTime(startsAt)}–${formatTime(endsAt)}`;

function bookingTone(status: PortalPtmBooking["status"]): "blue" | "green" | "amber" | "slate" {
  switch (status) {
    case "attended":
      return "green";
    case "no_show":
      return "amber";
    case "booked":
      return "blue";
    default:
      return "slate";
  }
}

const errMsg = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback;

export default function PortalPtmPage() {
  const { t } = useI18n();
  const role = usePortalStore((state) => state.user?.role);
  const kids = usePortalStore((state) => state.children);
  const selectedStudentId = usePortalStore((state) => state.selectedStudentId);
  const isStudent = role === "student";

  const [data, setData] = useState<PortalPtmData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Freshly fetched slots for the one expanded meeting.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [slots, setSlots] = useState<PortalPtmSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  // slotId → teacherName, merged from every slots fetch, so booking rows can
  // name the teacher without a dedicated endpoint.
  const [slotTeachers, setSlotTeachers] = useState<Record<string, string>>({});

  const [bookingTarget, setBookingTarget] = useState<{
    meeting: PortalPtmMeeting;
    slot: PortalPtmSlot;
  } | null>(null);
  const [bookingStudentId, setBookingStudentId] = useState<string>("");
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);

  const [cancelTarget, setCancelTarget] = useState<PortalPtmBooking | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const rememberTeachers = useCallback((list: PortalPtmSlot[]) => {
    setSlotTeachers((prev) => {
      const next = { ...prev };
      for (const s of list) next[s.id] = s.teacherName;
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const mine = await portalApi.get<PortalPtmData>("/ptm/my");
      setData(mine);
      // Resolve teacher names for booked slots (only meetings still listed
      // as scheduled are fetchable; older bookings honestly show no teacher).
      const listed = new Set(mine.meetings.map((m) => m.id));
      const withBookings = [
        ...new Set(mine.bookings.map((b) => b.meetingId).filter((id) => listed.has(id))),
      ];
      const results = await Promise.allSettled(
        withBookings.map((id) =>
          portalApi.get<PortalPtmSlot[]>(`/ptm/my/meetings/${id}/slots`)
        )
      );
      for (const r of results) {
        if (r.status === "fulfilled") rememberTeachers(r.value);
      }
    } catch (err) {
      setError(errMsg(err, "Could not load parent-teacher meetings."));
    } finally {
      setLoading(false);
    }
  }, [rememberTeachers]);

  useEffect(() => {
    if (isStudent) {
      setLoading(false);
      return;
    }
    load();
  }, [isStudent, load]);

  const loadSlots = useCallback(
    async (meetingId: string) => {
      setSlotsLoading(true);
      setSlotsError(null);
      setSlots([]);
      try {
        const list = await portalApi.get<PortalPtmSlot[]>(
          `/ptm/my/meetings/${meetingId}/slots`
        );
        setSlots(list);
        rememberTeachers(list);
      } catch (err) {
        setSlotsError(errMsg(err, "Could not load slots for this meeting."));
      } finally {
        setSlotsLoading(false);
      }
    },
    [rememberTeachers]
  );

  const toggleMeeting = (meetingId: string) => {
    if (expandedId === meetingId) {
      setExpandedId(null);
      setSlots([]);
      setSlotsError(null);
      return;
    }
    setExpandedId(meetingId);
    loadSlots(meetingId);
  };

  const refreshAfterChange = useCallback(async () => {
    await load();
    if (expandedId) await loadSlots(expandedId);
  }, [expandedId, load, loadSlots]);

  const meetingsById = useMemo(() => {
    const map = new Map<string, PortalPtmMeeting>();
    for (const m of data?.meetings ?? []) map.set(m.id, m);
    return map;
  }, [data]);

  const openBooking = (meeting: PortalPtmMeeting, slot: PortalPtmSlot) => {
    setNotice(null);
    setBookingError(null);
    const preferred =
      kids.find((k) => k.id === selectedStudentId)?.id ?? kids[0]?.id ?? "";
    setBookingStudentId(preferred);
    setBookingTarget({ meeting, slot });
  };

  const confirmBooking = async () => {
    if (!bookingTarget || !bookingStudentId) return;
    setBookingBusy(true);
    setBookingError(null);
    try {
      await portalApi.post("/ptm/my/bookings", {
        slotId: bookingTarget.slot.id,
        studentId: bookingStudentId,
      });
      const child = kids.find((k) => k.id === bookingStudentId);
      setNotice(
        `Booked ${formatWhen(bookingTarget.slot.startsAt, bookingTarget.slot.endsAt)} with ${bookingTarget.slot.teacherName}${child ? ` for ${child.firstName} ${child.lastName}` : ""}.`
      );
      setBookingTarget(null);
      await refreshAfterChange();
    } catch (err) {
      setBookingError(errMsg(err, "Could not book this slot."));
    } finally {
      setBookingBusy(false);
    }
  };

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      await portalApi.delete(`/ptm/my/bookings/${cancelTarget.id}`);
      setNotice("Booking cancelled. The slot has been freed.");
      setCancelTarget(null);
      await refreshAfterChange();
    } catch (err) {
      setCancelError(errMsg(err, "Could not cancel this booking."));
    } finally {
      setCancelBusy(false);
    }
  };

  const alreadyBooked =
    bookingTarget !== null &&
    bookingStudentId !== "" &&
    hasActiveBooking(data?.bookings ?? [], bookingTarget.meeting.id, bookingStudentId);

  if (isStudent) {
    return (
      <>
        <PageHeader title={t("portalPages.ptm.title")} />
        <EmptyState message="Slot booking is available to parent/guardian accounts. Please ask your parent or guardian to book a meeting time." />
      </>
    );
  }

  if (loading) return <Spinner />;

  if (error) {
    return (
      <>
        <PageHeader title={t("portalPages.ptm.title")} />
        <ErrorNote message={error} />
        <Button variant="secondary" onClick={load}>
          Try again
        </Button>
      </>
    );
  }

  if (kids.length === 0) {
    return (
      <>
        <PageHeader title={t("portalPages.ptm.title")} />
        <EmptyState message="No student linked to your account yet." />
      </>
    );
  }

  const bookings = data?.bookings ?? [];
  const meetings = data?.meetings ?? [];

  return (
    <>
      <PageHeader
        title={t("portalPages.ptm.title")}
        subtitle="Book a time to meet your child's teachers"
      />

      {notice && (
        <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </p>
      )}

      <h2 className="mb-3 text-lg font-semibold text-slate-900">Your bookings</h2>
      {bookings.length === 0 ? (
        <Card className="mb-8">
          <p className="text-sm text-slate-500">
            No bookings yet. Pick a meeting below to book a slot.
          </p>
        </Card>
      ) : (
        <div className="mb-8 space-y-3">
          {bookings.map((booking) => {
            const meeting = meetingsById.get(booking.meetingId);
            const teacher = slotTeachers[booking.slotId];
            return (
              <Card key={booking.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">
                      {meeting?.title ?? "Parent-teacher meeting"}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {formatWhen(booking.startsAt, booking.endsAt)}
                      {teacher ? ` · with ${teacher}` : ""}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      For {booking.studentName}
                      {meeting?.venue ? ` · ${meeting.venue}` : ""}
                    </p>
                    {meeting?.mode === "online" && meeting.joinLink && (
                      <a
                        href={meeting.joinLink}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
                      >
                        Join online meeting
                      </a>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={bookingTone(booking.status)}>
                      {booking.status.replace("_", " ")}
                    </Badge>
                    {booking.status === "booked" && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setNotice(null);
                          setCancelError(null);
                          setCancelTarget(booking);
                        }}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <h2 className="mb-3 text-lg font-semibold text-slate-900">Upcoming meetings</h2>
      {meetings.length === 0 ? (
        <EmptyState message="No parent-teacher meetings are open for booking right now." />
      ) : (
        <div className="space-y-4">
          {meetings.map((meeting) => {
            const mine = activeBookingsFor(bookings, meeting.id);
            const expanded = expandedId === meeting.id;
            return (
              <Card key={meeting.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-slate-900">{meeting.title}</p>
                      {mine.length > 0 && <Badge tone="green">Booked</Badge>}
                      {meeting.mode === "online" && <Badge tone="blue">Online</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      {formatDate(meeting.meetingDate)}
                      {meeting.venue ? ` · ${meeting.venue}` : ""}
                    </p>
                    {meeting.description && (
                      <p className="mt-1 whitespace-pre-line text-sm text-slate-500">
                        {meeting.description}
                      </p>
                    )}
                    {mine.length > 0 && (
                      <p className="mt-1 text-xs text-slate-500">
                        Booked for {mine.map((b) => b.studentName).join(", ")}
                      </p>
                    )}
                  </div>
                  <Button variant="secondary" onClick={() => toggleMeeting(meeting.id)}>
                    {expanded ? "Hide slots" : "View slots"}
                  </Button>
                </div>

                {expanded && (
                  <div className="mt-4 border-t border-slate-100 pt-4">
                    {slotsLoading ? (
                      <Spinner />
                    ) : slotsError ? (
                      <ErrorNote message={slotsError} />
                    ) : slots.length === 0 ? (
                      <p className="text-sm text-slate-500">
                        No slots have been published for this meeting yet.
                      </p>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {slots.map((slot) => {
                          const left = slotsLeft(slot);
                          const bookable = isSlotBookable(slot);
                          return (
                            <div
                              key={slot.id}
                              className="rounded-lg border border-slate-200 p-3"
                            >
                              <p className="text-sm font-medium text-slate-900">
                                {formatTime(slot.startsAt)}–{formatTime(slot.endsAt)}
                              </p>
                              <p className="mt-0.5 truncate text-sm text-slate-600">
                                {slot.teacherName}
                              </p>
                              <p className="mt-0.5 text-xs text-slate-400">
                                {formatDate(slot.startsAt)}
                              </p>
                              <div className="mt-2 flex items-center justify-between gap-2">
                                {bookable ? (
                                  <span className="text-xs text-slate-500">
                                    {left} of {slot.capacity} free
                                  </span>
                                ) : (
                                  <Badge tone="red">
                                    {slot.status === "open" ? "Full" : "Closed"}
                                  </Badge>
                                )}
                                <Button
                                  onClick={() => openBooking(meeting, slot)}
                                  disabled={!bookable}
                                >
                                  Book
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        title="Book this slot"
        open={bookingTarget !== null}
        onClose={() => (bookingBusy ? undefined : setBookingTarget(null))}
      >
        {bookingTarget && (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <p className="font-medium text-slate-900">{bookingTarget.meeting.title}</p>
              <p className="mt-0.5 text-slate-600">
                {formatWhen(bookingTarget.slot.startsAt, bookingTarget.slot.endsAt)} · with{" "}
                {bookingTarget.slot.teacherName}
              </p>
            </div>
            {kids.length > 1 ? (
              <Field label="Student">
                <Select
                  value={bookingStudentId}
                  onChange={(event) => {
                    setBookingStudentId(event.target.value);
                    setBookingError(null);
                  }}
                >
                  {kids.map((child) => (
                    <option key={child.id} value={child.id}>
                      {child.firstName} {child.lastName}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <p className="text-sm text-slate-600">
                For {kids[0]?.firstName} {kids[0]?.lastName}
              </p>
            )}
            {alreadyBooked && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                This student already has a booking for this meeting. Cancel it
                first to pick a different slot.
              </p>
            )}
            <ErrorNote message={bookingError} />
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setBookingTarget(null)}
                disabled={bookingBusy}
              >
                Close
              </Button>
              <Button
                onClick={confirmBooking}
                disabled={bookingBusy || alreadyBooked || !bookingStudentId}
              >
                {bookingBusy ? "Booking…" : "Confirm booking"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={cancelTarget !== null}
        title="Cancel this booking?"
        message={
          <div className="space-y-2">
            {cancelTarget && (
              <p>
                {formatWhen(cancelTarget.startsAt, cancelTarget.endsAt)} for{" "}
                {cancelTarget.studentName}. The slot will be freed for other
                parents; you can book a different slot afterwards.
              </p>
            )}
            <ErrorNote message={cancelError} />
          </div>
        }
        confirmLabel="Cancel booking"
        cancelLabel="Keep booking"
        busy={cancelBusy}
        onConfirm={confirmCancel}
        onClose={() => (cancelBusy ? undefined : setCancelTarget(null))}
      />
    </>
  );
}
