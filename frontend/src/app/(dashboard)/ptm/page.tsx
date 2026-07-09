"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import { useTerms } from "@/lib/terms";
import {
  Badge, Button, Card, EmptyState, ErrorNote, Field, Input,
  Modal, PageHeader, Select, Spinner,
} from "@/components/ui";
import type { Paginated } from "@/types";

// PR-T8 — Parent-Teacher Meetings (staff organizer). Schedule meetings, generate
// bookable slots per teacher, book students, and record attendance + notes.
// The guardian-scoped parent booking API (/ptm/my/*) is shipped + tested and will
// surface in the separate parent /portal in a follow-up.

const STATUS_TONE: Record<string, "slate" | "green" | "amber" | "red" | "blue"> = {
  draft: "slate", scheduled: "blue", completed: "green", cancelled: "red",
};
const textareaCls =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand-500";
const fmtDT = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

interface Meeting {
  id: string; title: string; description: string | null; meetingDate: string;
  venue: string | null; mode: string; joinLink: string | null; audienceType: string;
  audienceRef: string | null; status: string; slotCount?: number; bookingCount?: number;
}
interface Slot {
  id: string; teacherId: string; teacherName: string; startsAt: string; endsAt: string;
  capacity: number; status: string; booked: number;
}
interface Booking {
  id: string; slotId: string; studentId: string; studentName: string;
  status: string; notes: string | null; startsAt: string;
}
interface AudienceOption { label: string; type: string; ref: string | null }

function OrganizerView() {
  const t = useTerms();
  const [rows, setRows] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [audiences, setAudiences] = useState<AudienceOption[]>([{ label: "All parents", type: "all_parents", ref: null }]);
  const [teachers, setTeachers] = useState<{ id: string; name: string }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<Paginated<Meeting>>("/ptm/meetings?limit=50");
      setRows(r.data);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Best-effort reference data for the audience picker + slot teacher select.
  useEffect(() => {
    (async () => {
      const opts: AudienceOption[] = [{ label: "All parents", type: "all_parents", ref: null }];
      try {
        const cls = await api.get<{ id: string; name: string; sections: { id: string; name: string }[] }[]>("/academics/classes");
        for (const c of cls) {
          opts.push({ label: `Class: ${c.name}`, type: "class", ref: c.id });
          for (const s of c.sections ?? []) opts.push({ label: `Section: ${c.name}-${s.name}`, type: "section", ref: s.id });
        }
      } catch { /* not a school / no perm */ }
      try {
        const sems = await api.get<{ id: string; name: string }[]>("/college/semesters");
        for (const s of sems) opts.push({ label: `Semester: ${s.name}`, type: "semester", ref: s.id });
      } catch { /* not a college / no perm */ }
      try {
        const batches = await api.get<{ id: string; name: string }[]>("/college/batches");
        for (const b of batches) opts.push({ label: `Batch: ${b.name}`, type: "batch", ref: b.id });
      } catch { /* ignore */ }
      setAudiences(opts);
    })();
    api.get<Paginated<{ id: string; firstName: string; lastName: string }>>("/teachers?limit=200")
      .then((r) => setTeachers(r.data.map((x) => ({ id: x.id, name: `${x.firstName} ${x.lastName}` }))))
      .catch(() => undefined);
  }, []);

  return (
    <>
      <PageHeader
        title="Parent Meetings"
        subtitle={`Schedule ${t.teacher.toLowerCase()}–parent meetings, manage slots and record attendance`}
        action={<Button onClick={() => setCreateOpen(true)}>+ Schedule meeting</Button>}
      />
      <ErrorNote message={error} />
      {loading ? <Spinner /> : rows.length === 0 ? <EmptyState message="No meetings yet" /> : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr><th className="px-4 py-3">Meeting</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Audience</th><th className="px-4 py-3">Slots</th><th className="px-4 py-3">Booked</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((m) => (
                <tr key={m.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3 font-medium text-ink">{m.title}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{m.meetingDate}</td>
                  <td className="px-4 py-3 capitalize text-muted">{m.audienceType.replace("_", " ")}</td>
                  <td className="px-4 py-3 text-muted">{m.slotCount ?? 0}</td>
                  <td className="px-4 py-3 text-muted">{m.bookingCount ?? 0}</td>
                  <td className="px-4 py-3"><Badge tone={STATUS_TONE[m.status]}>{m.status}</Badge></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setDetail(m.id)} className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300">Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <CreateMeetingModal audiences={audiences} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); load(); }} />
      )}
      {detail && (
        <MeetingDetailModal meetingId={detail} teachers={teachers} onClose={() => { setDetail(null); load(); }} />
      )}
    </>
  );
}

function CreateMeetingModal({ audiences, onClose, onCreated }: { audiences: AudienceOption[]; onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState({ title: "", description: "", meetingDate: "", venue: "", mode: "in_person", joinLink: "", audienceIdx: "0" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setSaving(true); setErr(null);
    const a = audiences[Number(f.audienceIdx)] ?? audiences[0];
    const body: Record<string, unknown> = { title: f.title, meetingDate: f.meetingDate, mode: f.mode, audienceType: a.type };
    if (a.ref) body.audienceRef = a.ref;
    for (const k of ["description", "venue", "joinLink"] as const) if (f[k]) body[k] = f[k];
    try { await api.post("/ptm/meetings", body); onCreated(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Failed to schedule"); }
    finally { setSaving(false); }
  };
  return (
    <Modal title="Schedule a parent meeting" open onClose={onClose}>
      <div className="space-y-4">
        <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Description"><textarea rows={2} className={textareaCls} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" value={f.meetingDate} onChange={(e) => setF({ ...f, meetingDate: e.target.value })} /></Field>
          <Field label="Mode"><Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="in_person">In person</option><option value="online">Online</option></Select></Field>
        </div>
        {f.mode === "online"
          ? <Field label="Join link"><Input value={f.joinLink} onChange={(e) => setF({ ...f, joinLink: e.target.value })} /></Field>
          : <Field label="Venue"><Input value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} /></Field>}
        <Field label="Audience">
          <Select value={f.audienceIdx} onChange={(e) => setF({ ...f, audienceIdx: e.target.value })}>
            {audiences.map((a, i) => <option key={i} value={i}>{a.label}</option>)}
          </Select>
        </Field>
        <ErrorNote message={err} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !f.title || !f.meetingDate}>{saving ? "Saving…" : "Schedule"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function MeetingDetailModal({ meetingId, teachers, onClose }: { meetingId: string; teachers: { id: string; name: string }[]; onClose: () => void }) {
  const [m, setM] = useState<(Meeting & { slots: Slot[]; bookings: Booking[] }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [slot, setSlot] = useState({ teacherId: "", startsAt: "", endsAt: "", slotMinutes: "15", capacity: "1" });
  const load = useCallback(async () => {
    try { setM(await api.get(`/ptm/meetings/${meetingId}`)); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Failed to load"); }
  }, [meetingId]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setErr(null); setNote(null);
    try { await fn(); if (ok) setNote(ok); await load(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Action failed"); }
  };
  const publish = () => act(() => api.patch(`/ptm/meetings/${meetingId}`, { status: "scheduled" }), "Meeting published");
  const cancel = () => act(() => api.patch(`/ptm/meetings/${meetingId}`, { status: "cancelled" }));
  const invite = () => act(async () => { const r = await api.post<{ recipients: number }>(`/ptm/meetings/${meetingId}/invite`, {}); setNote(`Invites sent to ${r.recipients} recipient(s)`); });
  const addSlots = () => act(async () => {
    await api.post(`/ptm/meetings/${meetingId}/slots`, {
      teacherId: slot.teacherId, startsAt: slot.startsAt, endsAt: slot.endsAt,
      slotMinutes: Number(slot.slotMinutes), capacity: Number(slot.capacity),
    });
  }, "Slots added");
  const mark = (b: Booking, status: string) => act(() => api.patch(`/ptm/bookings/${b.id}`, { status }));

  return (
    <Modal title={m?.title ?? "Meeting"} open onClose={onClose}>
      {!m ? <Spinner /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <Badge tone={STATUS_TONE[m.status]}>{m.status}</Badge>
            <span>{m.meetingDate}</span>
            <span className="capitalize">· {m.mode.replace("_", " ")}</span>
            {m.venue && <span>· {m.venue}</span>}
            <span className="ml-auto flex gap-2">
              {m.status === "draft" && <Button onClick={publish}>Publish</Button>}
              {m.status === "scheduled" && <Button variant="secondary" onClick={invite}>Send invites</Button>}
              {m.status !== "cancelled" && <Button variant="danger" onClick={cancel}>Cancel</Button>}
            </span>
          </div>
          {note && <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">{note}</p>}
          <ErrorNote message={err} />

          <div>
            <h4 className="mb-2 text-sm font-semibold text-ink">Slots</h4>
            {m.slots.length === 0 ? <p className="text-sm text-muted">No slots yet.</p> : (
              <div className="space-y-1">
                {m.slots.map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
                    <span className="text-ink">{fmtDT(s.startsAt)} <span className="text-faint">· {s.teacherName}</span></span>
                    <Badge tone={s.booked >= s.capacity ? "amber" : "green"}>{s.booked}/{s.capacity}</Badge>
                  </div>
                ))}
              </div>
            )}
            <Card className="mt-3 p-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Select value={slot.teacherId} onChange={(e) => setSlot({ ...slot, teacherId: e.target.value })}>
                  <option value="">Teacher…</option>
                  {teachers.map((tt) => <option key={tt.id} value={tt.id}>{tt.name}</option>)}
                </Select>
                <Input type="datetime-local" value={slot.startsAt} onChange={(e) => setSlot({ ...slot, startsAt: e.target.value })} />
                <Input type="datetime-local" value={slot.endsAt} onChange={(e) => setSlot({ ...slot, endsAt: e.target.value })} />
                <Input type="number" min={5} value={slot.slotMinutes} onChange={(e) => setSlot({ ...slot, slotMinutes: e.target.value })} title="Minutes per slot" />
                <Button onClick={addSlots} disabled={!slot.teacherId || !slot.startsAt || !slot.endsAt}>Add</Button>
              </div>
            </Card>
          </div>

          <div>
            <h4 className="mb-2 text-sm font-semibold text-ink">Bookings</h4>
            {m.bookings.filter((b) => b.status !== "cancelled").length === 0 ? <p className="text-sm text-muted">No bookings yet.</p> : (
              <div className="space-y-1">
                {m.bookings.filter((b) => b.status !== "cancelled").map((b) => (
                  <div key={b.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
                    <span className="text-ink">{b.studentName} <span className="text-faint">· {fmtDT(b.startsAt)}</span></span>
                    <span className="flex items-center gap-2">
                      <Badge tone={b.status === "attended" ? "green" : b.status === "no_show" ? "red" : "blue"}>{b.status.replace("_", " ")}</Badge>
                      <button onClick={() => mark(b, "attended")} className="text-xs text-emerald-600 hover:underline">Attended</button>
                      <button onClick={() => mark(b, "no_show")} className="text-xs text-red-600 hover:underline">No-show</button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function PtmPage() {
  const { can, loading } = usePermissions();
  if (loading) return <Spinner />;
  if (!can("ptm:read")) {
    return (
      <>
        <PageHeader title="Parent Meetings" subtitle="Schedule and manage parent-teacher meetings" />
        <EmptyState message="You don't have access to parent meetings." />
      </>
    );
  }
  return <OrganizerView />;
}
