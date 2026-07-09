"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import type { Paginated } from "@/types";

// PR-T7 — unified Front-Office hub. Reuses the existing visitors / feedback /
// lost-found APIs unchanged and adds the two new registers (postal + calls) and a
// cross-surface summary. One page, five tabs, one permission namespace.

const TABS = [
  { key: "visitors", label: "Visitors" },
  { key: "complaints", label: "Enquiries & Complaints" },
  { key: "lost-found", label: "Lost & Found" },
  { key: "postal", label: "Postal / Dispatch" },
  { key: "calls", label: "Call Register" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

type Tone = "slate" | "green" | "amber" | "red" | "blue";
const textareaCls =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand-500";
const fmtDT = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
const dash = (v: string | null | undefined) => (v && v.length ? v : "—");

// Shared paginated list hook. Tabs own their filter state and call setPage(1) in
// the same handler as the filter change, so React batches → exactly one reload.
function useRegister<T>(path: string, filters: Record<string, string>) {
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const limit = 10;
  const filterKey = JSON.stringify(filters);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      for (const [k, v] of Object.entries(JSON.parse(filterKey) as Record<string, string>)) {
        if (v) params.set(k, v);
      }
      const res = await api.get<Paginated<T>>(`${path}?${params.toString()}`);
      setRows(res.data);
      setTotal(res.meta.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [page, path, filterKey]);
  useEffect(() => {
    load();
  }, [load]);
  return { rows, total, page, setPage, loading, error, reload: load, limit };
}

function Pager({
  page, total, limit, onPage,
}: { page: number; total: number; limit: number; onPage: (p: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-end gap-2 text-sm">
      <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
      <span className="text-muted">Page {page} of {totalPages}</span>
      <Button variant="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary strip
// ---------------------------------------------------------------------------

interface Summary {
  visitorsInside: number;
  openComplaints: number;
  openLostFound: number;
  dispatchesToday: number;
  callsToday: number;
  followUpsDue: number;
}

function SummaryStrip({ bump }: { bump: number }) {
  const [s, setS] = useState<Summary | null>(null);
  useEffect(() => {
    api.get<Summary>("/front-office/summary").then(setS).catch(() => setS(null));
  }, [bump]);
  const tiles: { label: string; value: number; icon: IconName; tone: string }[] = [
    { label: "Visitors inside", value: s?.visitorsInside ?? 0, icon: "users", tone: "text-emerald-600 dark:text-emerald-400" },
    { label: "Open complaints", value: s?.openComplaints ?? 0, icon: "message", tone: "text-amber-600 dark:text-amber-400" },
    { label: "Open lost & found", value: s?.openLostFound ?? 0, icon: "tag", tone: "text-blue-600 dark:text-blue-400" },
    { label: "Dispatches today", value: s?.dispatchesToday ?? 0, icon: "package", tone: "text-violet-600 dark:text-violet-400" },
    { label: "Calls today", value: s?.callsToday ?? 0, icon: "phone", tone: "text-brand-600 dark:text-brand-300" },
    { label: "Follow-ups due", value: s?.followUpsDue ?? 0, icon: "calcheck", tone: "text-red-600 dark:text-red-400" },
  ];
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t) => (
        <Card key={t.label} className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted">
            <Icon name={t.icon} className="h-4 w-4" />
            {t.label}
          </div>
          <div className={`mt-1 text-2xl font-semibold ${t.tone}`}>{t.value}</div>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visitors tab
// ---------------------------------------------------------------------------

interface Visitor {
  id: string; visitorName: string; phone: string | null; purpose: string | null;
  whomToMeet: string | null; badgeNo: string | null; inTime: string; outTime: string | null;
}

function VisitorsTab({ canManage, onChanged }: { canManage: boolean; onChanged: () => void }) {
  const [search, setSearch] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const reg = useRegister<Visitor>("/visitors", { search, active: activeOnly ? "true" : "" });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ visitorName: "", phone: "", purpose: "", whomToMeet: "", badgeNo: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Visitor | null>(null);

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await api.post("/visitors", { ...form, phone: form.phone || undefined });
      setOpen(false); setForm({ visitorName: "", phone: "", purpose: "", whomToMeet: "", badgeNo: "" });
      await reg.reload(); onChanged();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Failed to check in"); }
    finally { setSaving(false); }
  };
  const checkout = async (v: Visitor) => {
    setRowErr(null);
    try { await api.post(`/visitors/${v.id}/checkout`, {}); await reg.reload(); onChanged(); }
    catch (e) { setRowErr(e instanceof ApiError ? e.message : "Failed to check out"); }
  };
  const remove = async () => {
    if (!toDelete) return;
    try { await api.delete(`/visitors/${toDelete.id}`); setToDelete(null); await reg.reload(); onChanged(); }
    catch (e) { setRowErr(e instanceof ApiError ? e.message : "Failed to delete"); }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-64">
          <Input placeholder="Search name, phone or host…" value={search}
            onChange={(e) => { setSearch(e.target.value); reg.setPage(1); }} />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={activeOnly} onChange={(e) => { setActiveOnly(e.target.checked); reg.setPage(1); }} />
          Currently inside
        </label>
        {canManage && <Button className="ml-auto" onClick={() => setOpen(true)}>+ Check in visitor</Button>}
      </div>
      <ErrorNote message={reg.error ?? rowErr} />
      {reg.loading ? <Spinner /> : reg.rows.length === 0 ? <EmptyState message="No visitor entries" /> : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr><th className="px-4 py-3">Visitor</th><th className="px-4 py-3">Purpose</th><th className="px-4 py-3">To meet</th><th className="px-4 py-3">In</th><th className="px-4 py-3">Out</th><th className="px-4 py-3" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {reg.rows.map((v) => (
                <tr key={v.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3"><span className="font-medium text-ink">{v.visitorName}</span>{v.phone && <span className="block text-xs text-faint">{v.phone}</span>}</td>
                  <td className="px-4 py-3 text-muted">{dash(v.purpose)}</td>
                  <td className="px-4 py-3 text-muted">{dash(v.whomToMeet)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{fmtDT(v.inTime)}</td>
                  <td className="whitespace-nowrap px-4 py-3">{v.outTime ? <span className="text-muted">{fmtDT(v.outTime)}</span> : <Badge tone="green">inside</Badge>}</td>
                  <td className="px-4 py-3 text-right">
                    {canManage && (
                      <div className="flex justify-end gap-3">
                        {!v.outTime && <button onClick={() => checkout(v)} className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300">Check out</button>}
                        <button onClick={() => setToDelete(v)} className="text-xs font-medium text-red-600 hover:text-red-700">Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={reg.page} total={reg.total} limit={reg.limit} onPage={reg.setPage} />

      <Modal title="Check in visitor" open={open} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <Field label="Visitor name"><Input value={form.visitorName} onChange={(e) => setForm({ ...form, visitorName: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Badge no"><Input value={form.badgeNo} onChange={(e) => setForm({ ...form, badgeNo: e.target.value })} /></Field>
          </div>
          <Field label="Purpose"><Input placeholder="e.g. Admission enquiry" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></Field>
          <Field label="Whom to meet"><Input value={form.whomToMeet} onChange={(e) => setForm({ ...form, whomToMeet: e.target.value })} /></Field>
          <ErrorNote message={err} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.visitorName}>{saving ? "Saving…" : "Check in"}</Button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog open={toDelete !== null} title="Delete visitor entry"
        message={`Delete the entry for ${toDelete?.visitorName}?`} onConfirm={remove} onClose={() => setToDelete(null)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Enquiries & Complaints tab (feedback)
// ---------------------------------------------------------------------------

const FB_TYPES = ["feedback", "complaint", "suggestion", "grievance", "enquiry"] as const;
const FB_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
interface Complaint {
  id: string; type: string; subject: string; message: string; submitterName: string | null;
  submitterContact: string | null; status: string; resolution: string | null; createdAt: string;
}
const fbTone = (s: string): Tone => (s === "resolved" ? "green" : s === "in_progress" ? "blue" : s === "closed" ? "slate" : "amber");

function ComplaintsTab({ canManage, onChanged }: { canManage: boolean; onChanged: () => void }) {
  const [search, setSearch] = useState("");
  const [typeF, setTypeF] = useState("");
  const [statusF, setStatusF] = useState("");
  const reg = useRegister<Complaint>("/feedback", { search, type: typeF, status: statusF });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ type: "complaint", subject: "", message: "", submitterName: "", submitterContact: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<string | null>(null);
  const [manage, setManage] = useState<Complaint | null>(null);
  const [mStatus, setMStatus] = useState("open");
  const [mRes, setMRes] = useState("");
  const [mSaving, setMSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Complaint | null>(null);

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await api.post("/feedback", { ...form, submitterName: form.submitterName || undefined, submitterContact: form.submitterContact || undefined });
      setOpen(false); setForm({ type: "complaint", subject: "", message: "", submitterName: "", submitterContact: "" });
      await reg.reload(); onChanged();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Failed to save"); }
    finally { setSaving(false); }
  };
  const openManage = (c: Complaint) => { setManage(c); setMStatus(c.status); setMRes(c.resolution ?? ""); };
  const saveManage = async () => {
    if (!manage) return;
    setMSaving(true); setRowErr(null);
    try { await api.patch(`/feedback/${manage.id}`, { status: mStatus, resolution: mRes || undefined }); setManage(null); await reg.reload(); onChanged(); }
    catch (e) { setRowErr(e instanceof ApiError ? e.message : "Failed to update"); }
    finally { setMSaving(false); }
  };
  const remove = async () => {
    if (!toDelete) return;
    try { await api.delete(`/feedback/${toDelete.id}`); setToDelete(null); await reg.reload(); onChanged(); }
    catch (e) { setRowErr(e instanceof ApiError ? e.message : "Failed to delete"); }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-56"><Input placeholder="Search subject or submitter…" value={search} onChange={(e) => { setSearch(e.target.value); reg.setPage(1); }} /></div>
        <div className="w-40"><Select value={typeF} onChange={(e) => { setTypeF(e.target.value); reg.setPage(1); }}><option value="">All types</option>{FB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
        <div className="w-40"><Select value={statusF} onChange={(e) => { setStatusF(e.target.value); reg.setPage(1); }}><option value="">All statuses</option>{FB_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</Select></div>
        {canManage && <Button className="ml-auto" onClick={() => setOpen(true)}>+ Log entry</Button>}
      </div>
      <ErrorNote message={reg.error ?? rowErr} />
      {reg.loading ? <Spinner /> : reg.rows.length === 0 ? <EmptyState message="No entries" /> : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr><th className="px-4 py-3">Subject</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">From</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {reg.rows.map((c) => (
                <tr key={c.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3 font-medium text-ink">{c.subject}</td>
                  <td className="px-4 py-3 capitalize text-muted">{c.type}</td>
                  <td className="px-4 py-3 text-muted">{dash(c.submitterName)}</td>
                  <td className="px-4 py-3"><Badge tone={fbTone(c.status)}>{c.status.replace("_", " ")}</Badge></td>
                  <td className="px-4 py-3 text-right">
                    {canManage && (
                      <div className="flex justify-end gap-3">
                        <button onClick={() => openManage(c)} className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300">Manage</button>
                        <button onClick={() => setToDelete(c)} className="text-xs font-medium text-red-600 hover:text-red-700">Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={reg.page} total={reg.total} limit={reg.limit} onPage={reg.setPage} />

      <Modal title="Log enquiry / complaint" open={open} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{FB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
            <Field label="From (name)"><Input value={form.submitterName} onChange={(e) => setForm({ ...form, submitterName: e.target.value })} /></Field>
          </div>
          <Field label="Subject"><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
          <Field label="Message"><textarea rows={4} className={textareaCls} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field>
          <Field label="Contact"><Input value={form.submitterContact} onChange={(e) => setForm({ ...form, submitterContact: e.target.value })} /></Field>
          <ErrorNote message={err} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.subject || !form.message}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      </Modal>

      <Modal title={manage?.subject ?? "Entry"} open={manage !== null} onClose={() => setManage(null)}>
        {manage && (
          <div className="space-y-4">
            <p className="whitespace-pre-wrap rounded-lg border border-line bg-surface-2 p-3 text-sm text-muted">{manage.message}</p>
            {manage.submitterContact && <p className="text-xs text-faint">Contact: {manage.submitterContact}</p>}
            <Field label="Status"><Select value={mStatus} onChange={(e) => setMStatus(e.target.value)}>{FB_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</Select></Field>
            <Field label="Resolution / notes"><textarea rows={3} className={textareaCls} value={mRes} onChange={(e) => setMRes(e.target.value)} /></Field>
            <ErrorNote message={rowErr} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setManage(null)}>Cancel</Button>
              <Button onClick={saveManage} disabled={mSaving}>{mSaving ? "Saving…" : "Save"}</Button>
            </div>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={toDelete !== null} title="Delete entry" message="Delete this entry?" onConfirm={remove} onClose={() => setToDelete(null)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Lost & Found tab
// ---------------------------------------------------------------------------

const LF_TYPES = ["lost", "found"] as const;
const LF_STATUSES = ["open", "claimed", "returned", "closed"] as const;
interface LFItem {
  id: string; type: string; title: string; description: string | null; location: string | null;
  status: string; reporterName: string | null; reporterContact: string | null; itemDate: string;
}
const lfTone = (s: string): Tone => (s === "returned" ? "green" : s === "claimed" ? "blue" : s === "closed" ? "slate" : "amber");
const emptyLF = { type: "found", title: "", description: "", location: "", reporterName: "", reporterContact: "", status: "open" };

function LostFoundTab({ canManage, onChanged }: { canManage: boolean; onChanged: () => void }) {
  const [search, setSearch] = useState("");
  const [typeF, setTypeF] = useState("");
  const [statusF, setStatusF] = useState("");
  const reg = useRegister<LFItem>("/lost-found", { search, type: typeF, status: statusF });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LFItem | null>(null);
  const [form, setForm] = useState<Record<string, string>>(emptyLF);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<LFItem | null>(null);

  const openCreate = () => { setEditing(null); setForm(emptyLF); setErr(null); setOpen(true); };
  const openEdit = (i: LFItem) => {
    setEditing(i);
    setForm({ type: i.type, title: i.title, description: i.description ?? "", location: i.location ?? "", reporterName: i.reporterName ?? "", reporterContact: i.reporterContact ?? "", status: i.status });
    setErr(null); setOpen(true);
  };
  const save = async () => {
    setSaving(true); setErr(null);
    const body = { ...form, description: form.description || undefined, location: form.location || undefined, reporterName: form.reporterName || undefined, reporterContact: form.reporterContact || undefined };
    try {
      if (editing) await api.patch(`/lost-found/${editing.id}`, body);
      else await api.post("/lost-found", body);
      setOpen(false); await reg.reload(); onChanged();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Failed to save"); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!toDelete) return;
    try { await api.delete(`/lost-found/${toDelete.id}`); setToDelete(null); await reg.reload(); onChanged(); }
    catch (e) { setRowErr(e instanceof ApiError ? e.message : "Failed to delete"); }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-56"><Input placeholder="Search title, location…" value={search} onChange={(e) => { setSearch(e.target.value); reg.setPage(1); }} /></div>
        <div className="w-36"><Select value={typeF} onChange={(e) => { setTypeF(e.target.value); reg.setPage(1); }}><option value="">All</option>{LF_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
        <div className="w-40"><Select value={statusF} onChange={(e) => { setStatusF(e.target.value); reg.setPage(1); }}><option value="">All statuses</option>{LF_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></div>
        {canManage && <Button className="ml-auto" onClick={openCreate}>+ Log item</Button>}
      </div>
      <ErrorNote message={reg.error ?? rowErr} />
      {reg.loading ? <Spinner /> : reg.rows.length === 0 ? <EmptyState message="No items" /> : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr><th className="px-4 py-3">Item</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Location</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {reg.rows.map((i) => (
                <tr key={i.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3"><span className="font-medium text-ink">{i.title}</span>{i.reporterName && <span className="block text-xs text-faint">by {i.reporterName}</span>}</td>
                  <td className="px-4 py-3 capitalize text-muted">{i.type}</td>
                  <td className="px-4 py-3 text-muted">{dash(i.location)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{i.itemDate}</td>
                  <td className="px-4 py-3"><Badge tone={lfTone(i.status)}>{i.status}</Badge></td>
                  <td className="px-4 py-3 text-right">
                    {canManage && (
                      <div className="flex justify-end gap-3">
                        <button onClick={() => openEdit(i)} className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300">Edit</button>
                        <button onClick={() => setToDelete(i)} className="text-xs font-medium text-red-600 hover:text-red-700">Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={reg.page} total={reg.total} limit={reg.limit} onPage={reg.setPage} />

      <Modal title={editing ? "Edit item" : "Log lost / found item"} open={open} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{LF_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
            <Field label="Status"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{LF_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
          </div>
          <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Description"><textarea rows={3} className={textareaCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Location"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
            <Field label="Reporter"><Input value={form.reporterName} onChange={(e) => setForm({ ...form, reporterName: e.target.value })} /></Field>
          </div>
          <Field label="Reporter contact"><Input value={form.reporterContact} onChange={(e) => setForm({ ...form, reporterContact: e.target.value })} /></Field>
          <ErrorNote message={err} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.title}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog open={toDelete !== null} title="Delete item" message={`Delete "${toDelete?.title}"?`} onConfirm={remove} onClose={() => setToDelete(null)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Postal / Dispatch tab
// ---------------------------------------------------------------------------

const PD_DIRECTIONS = ["inbound", "outbound"] as const;
const PD_ITEM_TYPES = ["letter", "parcel", "courier", "speed_post", "other"] as const;
const PD_STATUSES = ["received", "dispatched", "delivered", "collected"] as const;
interface Dispatch {
  id: string; direction: string; itemType: string; refNo: string | null; partyName: string;
  addressee: string | null; carrier: string | null; trackingNo: string | null; itemDate: string;
  status: string; remarks: string | null;
}
const pdTone = (s: string): Tone => (s === "delivered" || s === "collected" ? "green" : s === "dispatched" ? "blue" : "amber");
const emptyPD = { direction: "inbound", itemType: "letter", refNo: "", partyName: "", addressee: "", carrier: "", trackingNo: "", itemDate: "", status: "", remarks: "" };

function PostalTab({ canManage, onChanged }: { canManage: boolean; onChanged: () => void }) {
  const [search, setSearch] = useState("");
  const [dirF, setDirF] = useState("");
  const [statusF, setStatusF] = useState("");
  const reg = useRegister<Dispatch>("/front-office/postal", { search, direction: dirF, status: statusF });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Dispatch | null>(null);
  const [form, setForm] = useState<Record<string, string>>(emptyPD);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Dispatch | null>(null);

  const openCreate = () => { setEditing(null); setForm(emptyPD); setErr(null); setOpen(true); };
  const openEdit = (d: Dispatch) => {
    setEditing(d);
    setForm({ direction: d.direction, itemType: d.itemType, refNo: d.refNo ?? "", partyName: d.partyName, addressee: d.addressee ?? "", carrier: d.carrier ?? "", trackingNo: d.trackingNo ?? "", itemDate: d.itemDate, status: d.status, remarks: d.remarks ?? "" });
    setErr(null); setOpen(true);
  };
  const save = async () => {
    setSaving(true); setErr(null);
    const body: Record<string, unknown> = { direction: form.direction, itemType: form.itemType, partyName: form.partyName };
    for (const k of ["refNo", "addressee", "carrier", "trackingNo", "itemDate", "status", "remarks"]) if (form[k]) body[k] = form[k];
    try {
      if (editing) await api.patch(`/front-office/postal/${editing.id}`, body);
      else await api.post("/front-office/postal", body);
      setOpen(false); await reg.reload(); onChanged();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Failed to save"); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!toDelete) return;
    try { await api.delete(`/front-office/postal/${toDelete.id}`); setToDelete(null); await reg.reload(); onChanged(); }
    catch (e) { setRowErr(e instanceof ApiError ? e.message : "Failed to delete"); }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-56"><Input placeholder="Search party, tracking, ref…" value={search} onChange={(e) => { setSearch(e.target.value); reg.setPage(1); }} /></div>
        <div className="w-40"><Select value={dirF} onChange={(e) => { setDirF(e.target.value); reg.setPage(1); }}><option value="">All</option>{PD_DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}</Select></div>
        <div className="w-40"><Select value={statusF} onChange={(e) => { setStatusF(e.target.value); reg.setPage(1); }}><option value="">All statuses</option>{PD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></div>
        {canManage && <Button className="ml-auto" onClick={openCreate}>+ Log item</Button>}
      </div>
      <ErrorNote message={reg.error ?? rowErr} />
      {reg.loading ? <Spinner /> : reg.rows.length === 0 ? <EmptyState message="No dispatch entries" /> : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr><th className="px-4 py-3">Party</th><th className="px-4 py-3">Dir.</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Carrier / Tracking</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {reg.rows.map((d) => (
                <tr key={d.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3"><span className="font-medium text-ink">{d.partyName}</span>{d.addressee && <span className="block text-xs text-faint">{d.addressee}</span>}</td>
                  <td className="px-4 py-3"><Badge tone={d.direction === "inbound" ? "blue" : "slate"}>{d.direction}</Badge></td>
                  <td className="px-4 py-3 capitalize text-muted">{d.itemType.replace("_", " ")}</td>
                  <td className="px-4 py-3 text-muted">{dash(d.carrier)}{d.trackingNo && <span className="block text-xs text-faint">{d.trackingNo}</span>}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{d.itemDate}</td>
                  <td className="px-4 py-3"><Badge tone={pdTone(d.status)}>{d.status}</Badge></td>
                  <td className="px-4 py-3 text-right">
                    {canManage && (
                      <div className="flex justify-end gap-3">
                        <button onClick={() => openEdit(d)} className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300">Edit</button>
                        <button onClick={() => setToDelete(d)} className="text-xs font-medium text-red-600 hover:text-red-700">Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={reg.page} total={reg.total} limit={reg.limit} onPage={reg.setPage} />

      <Modal title={editing ? "Edit dispatch" : "Log postal / dispatch"} open={open} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Direction"><Select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>{PD_DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}</Select></Field>
            <Field label="Item type"><Select value={form.itemType} onChange={(e) => setForm({ ...form, itemType: e.target.value })}>{PD_ITEM_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}</Select></Field>
          </div>
          <Field label={form.direction === "inbound" ? "Sender" : "Recipient"}><Input value={form.partyName} onChange={(e) => setForm({ ...form, partyName: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Addressee (internal)"><Input value={form.addressee} onChange={(e) => setForm({ ...form, addressee: e.target.value })} /></Field>
            <Field label="Ref no"><Input value={form.refNo} onChange={(e) => setForm({ ...form, refNo: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Carrier"><Input value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })} /></Field>
            <Field label="Tracking no"><Input value={form.trackingNo} onChange={(e) => setForm({ ...form, trackingNo: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date"><Input type="date" value={form.itemDate} onChange={(e) => setForm({ ...form, itemDate: e.target.value })} /></Field>
            <Field label="Status"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="">Auto</option>{PD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
          </div>
          <Field label="Remarks"><textarea rows={2} className={textareaCls} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></Field>
          <ErrorNote message={err} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.partyName}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog open={toDelete !== null} title="Delete dispatch" message={`Delete the entry for ${toDelete?.partyName}?`} onConfirm={remove} onClose={() => setToDelete(null)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Call register tab
// ---------------------------------------------------------------------------

const CALL_DIRECTIONS = ["incoming", "outgoing"] as const;
const CALL_RELATED = ["general", "admission", "enquiry", "complaint", "fees", "transport", "other"] as const;
interface Call {
  id: string; direction: string; callerName: string; phone: string | null; purpose: string | null;
  relatedTo: string; followUpDate: string | null; notes: string | null; callTime: string;
}
const emptyCall = { direction: "incoming", callerName: "", phone: "", purpose: "", relatedTo: "general", followUpDate: "", notes: "" };

function CallsTab({ canManage, onChanged }: { canManage: boolean; onChanged: () => void }) {
  const [search, setSearch] = useState("");
  const [dirF, setDirF] = useState("");
  const [relF, setRelF] = useState("");
  const reg = useRegister<Call>("/front-office/calls", { search, direction: dirF, relatedTo: relF });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Call | null>(null);
  const [form, setForm] = useState<Record<string, string>>(emptyCall);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Call | null>(null);

  const openCreate = () => { setEditing(null); setForm(emptyCall); setErr(null); setOpen(true); };
  const openEdit = (c: Call) => {
    setEditing(c);
    setForm({ direction: c.direction, callerName: c.callerName, phone: c.phone ?? "", purpose: c.purpose ?? "", relatedTo: c.relatedTo, followUpDate: c.followUpDate ?? "", notes: c.notes ?? "" });
    setErr(null); setOpen(true);
  };
  const save = async () => {
    setSaving(true); setErr(null);
    const body: Record<string, unknown> = { direction: form.direction, callerName: form.callerName, relatedTo: form.relatedTo };
    for (const k of ["phone", "purpose", "followUpDate", "notes"]) if (form[k]) body[k] = form[k];
    try {
      if (editing) await api.patch(`/front-office/calls/${editing.id}`, body);
      else await api.post("/front-office/calls", body);
      setOpen(false); await reg.reload(); onChanged();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Failed to save"); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!toDelete) return;
    try { await api.delete(`/front-office/calls/${toDelete.id}`); setToDelete(null); await reg.reload(); onChanged(); }
    catch (e) { setRowErr(e instanceof ApiError ? e.message : "Failed to delete"); }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-56"><Input placeholder="Search caller, phone, purpose…" value={search} onChange={(e) => { setSearch(e.target.value); reg.setPage(1); }} /></div>
        <div className="w-40"><Select value={dirF} onChange={(e) => { setDirF(e.target.value); reg.setPage(1); }}><option value="">All</option>{CALL_DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}</Select></div>
        <div className="w-40"><Select value={relF} onChange={(e) => { setRelF(e.target.value); reg.setPage(1); }}><option value="">All topics</option>{CALL_RELATED.map((r) => <option key={r} value={r}>{r}</option>)}</Select></div>
        {canManage && <Button className="ml-auto" onClick={openCreate}>+ Log call</Button>}
      </div>
      <ErrorNote message={reg.error ?? rowErr} />
      {reg.loading ? <Spinner /> : reg.rows.length === 0 ? <EmptyState message="No call entries" /> : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr><th className="px-4 py-3">Caller</th><th className="px-4 py-3">Dir.</th><th className="px-4 py-3">Topic</th><th className="px-4 py-3">When</th><th className="px-4 py-3">Follow-up</th><th className="px-4 py-3" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {reg.rows.map((c) => (
                <tr key={c.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3"><span className="font-medium text-ink">{c.callerName}</span>{c.phone && <span className="block text-xs text-faint">{c.phone}</span>}</td>
                  <td className="px-4 py-3"><Badge tone={c.direction === "incoming" ? "blue" : "slate"}>{c.direction}</Badge></td>
                  <td className="px-4 py-3 capitalize text-muted">{c.relatedTo}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{fmtDT(c.callTime)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{dash(c.followUpDate)}</td>
                  <td className="px-4 py-3 text-right">
                    {canManage && (
                      <div className="flex justify-end gap-3">
                        <button onClick={() => openEdit(c)} className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300">Edit</button>
                        <button onClick={() => setToDelete(c)} className="text-xs font-medium text-red-600 hover:text-red-700">Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={reg.page} total={reg.total} limit={reg.limit} onPage={reg.setPage} />

      <Modal title={editing ? "Edit call" : "Log call"} open={open} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Direction"><Select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>{CALL_DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}</Select></Field>
            <Field label="Topic"><Select value={form.relatedTo} onChange={(e) => setForm({ ...form, relatedTo: e.target.value })}>{CALL_RELATED.map((r) => <option key={r} value={r}>{r}</option>)}</Select></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Caller"><Input value={form.callerName} onChange={(e) => setForm({ ...form, callerName: e.target.value })} /></Field>
            <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          </div>
          <Field label="Purpose"><Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></Field>
          <Field label="Follow-up date"><Input type="date" value={form.followUpDate} onChange={(e) => setForm({ ...form, followUpDate: e.target.value })} /></Field>
          <Field label="Notes"><textarea rows={2} className={textareaCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <ErrorNote message={err} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.callerName}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog open={toDelete !== null} title="Delete call" message={`Delete the call from ${toDelete?.callerName}?`} onConfirm={remove} onClose={() => setToDelete(null)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

export default function FrontOfficePage() {
  const { can } = usePermissions();
  const canManage = can("front_office:manage");
  const [tab, setTab] = useState<TabKey>("visitors");
  const [bump, setBump] = useState(0);
  const onChanged = useCallback(() => setBump((b) => b + 1), []);

  // Deep-link a tab from ?tab= (the retired /feedback + /lost-found routes redirect
  // here). Client-only read to avoid the useSearchParams Suspense requirement.
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("tab");
    if (raw && TABS.some((t) => t.key === raw)) setTab(raw as TabKey);
  }, []);

  return (
    <>
      <PageHeader title="Front Office" subtitle="Visitors, enquiries & complaints, lost & found, postal/dispatch and calls" />
      <SummaryStrip bump={bump} />

      <div className="mb-5 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === t.key
                ? "border-brand-500 text-brand-700 dark:text-brand-300"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "visitors" && <VisitorsTab canManage={canManage} onChanged={onChanged} />}
      {tab === "complaints" && <ComplaintsTab canManage={canManage} onChanged={onChanged} />}
      {tab === "lost-found" && <LostFoundTab canManage={canManage} onChanged={onChanged} />}
      {tab === "postal" && <PostalTab canManage={canManage} onChanged={onChanged} />}
      {tab === "calls" && <CallsTab canManage={canManage} onChanged={onChanged} />}
    </>
  );
}
