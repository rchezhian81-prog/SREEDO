"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import {
  Badge, Button, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Textarea,
} from "@/components/ui";
import { usePlatformGuard } from "../platform/_guard";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const INSTITUTION_TYPES = ["school", "college", "university", "coaching", "other"] as const;

interface Package {
  id: string;
  name: string;
  description: string | null;
  currency: string;
  price: string | number;
  billingCycle: "monthly" | "quarterly" | "annual";
  status: "active" | "draft" | "deprecated" | "archived";
  visibility: "public" | "internal" | "hidden";
  badge: string | null;
  displayOrder: number;
  applicableTypes: string[];
  maxStudents: number | null;
  maxStaff: number | null;
  isTrial: boolean;
  trialDays: number | null;
  createdAt: string;
}

const statusTone = (s: string) =>
  s === "active" ? "green" : s === "draft" ? "amber" : s === "deprecated" ? "red" : "slate";

function authToken() { return useAuthStore.getState().accessToken; }
async function downloadFile(path: string, filename: string) {
  const res = await fetch(`${API_URL}${path}`, { headers: authToken() ? { Authorization: `Bearer ${authToken()}` } : {} });
  if (!res.ok) throw new Error("Download failed");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function PackagesPage() {
  const { ready, gate } = usePlatformGuard("Packages", "SaaS plan administration");
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [institutionType, setInstitutionType] = useState("");
  const [billingCycle, setBillingCycle] = useState("");
  const [sort, setSort] = useState("displayOrder");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [compareOpen, setCompareOpen] = useState(false);

  useEffect(() => {
    if (!notice) return;
    const x = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(x);
  }, [notice]);

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (status) p.set("status", status);
    if (institutionType) p.set("institutionType", institutionType);
    if (billingCycle) p.set("billingCycle", billingCycle);
    if (sort) p.set("sort", sort);
    return p;
  }, [q, status, institutionType, billingCycle, sort]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPackages(await api.get<Package[]>(`/packages?${buildQuery().toString()}`));
    } catch (err) {
      setPackages([]);
      setError(err instanceof ApiError ? err.message : "Failed to load packages");
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  const toggleSel = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else if (n.size < 4) n.add(id);
      return n;
    });

  const exportList = (format: "csv" | "xlsx") => {
    const p = buildQuery(); p.set("format", format);
    downloadFile(`/packages-export?${p.toString()}`, `packages.${format}`).catch(() => setError("Export failed"));
  };

  if (!ready) return gate;

  return (
    <>
      <PageHeader
        title="Packages & Plans"
        subtitle={`${packages.length} plan${packages.length === 1 ? "" : "s"} · one common system across institution types`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => exportList("csv")}>Export CSV</Button>
            <Button variant="secondary" onClick={() => exportList("xlsx")}>Export XLSX</Button>
            <Link href="/super-admin/packages/usage"><Button variant="secondary">Usage report</Button></Link>
            <Button onClick={() => setCreateOpen(true)}>+ New package</Button>
          </div>
        }
      />

      {notice && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}
      {error && <ErrorNote message={error} />}

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Input placeholder="Search name…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {["active", "draft", "deprecated", "archived"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </Select>
        <Select value={institutionType} onChange={(e) => setInstitutionType(e.target.value)}>
          <option value="">All types</option>
          {INSTITUTION_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
        </Select>
        <Select value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)}>
          <option value="">All cycles</option>
          {["monthly", "quarterly", "annual"].map((b) => <option key={b} value={b}>{b[0].toUpperCase() + b.slice(1)}</option>)}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="displayOrder">Sort: Order</option>
          <option value="name">Sort: Name</option>
          <option value="price">Sort: Price</option>
          <option value="status">Sort: Status</option>
          <option value="createdAt">Sort: Created</option>
        </Select>
      </div>

      {selected.size >= 2 && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
          <span className="font-medium text-brand-700">{selected.size} selected</span>
          <Button variant="secondary" onClick={() => setCompareOpen(true)}>Compare</Button>
          <button className="text-xs text-slate-500 hover:text-slate-700" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : packages.length === 0 ? (
        <EmptyState message={q || status || institutionType || billingCycle ? "No packages match these filters." : "No packages yet. Create one to get started."} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-3" />
                <th className="px-4 py-3">Name</th><th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Visibility</th><th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Billing</th><th className="px-4 py-3">Types</th>
                <th className="px-4 py-3">Max students</th><th className="px-4 py-3">Max staff</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {packages.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-3 py-3">
                    <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={selected.has(p.id)} onChange={() => toggleSel(p.id)} aria-label={`Select ${p.name}`} />
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <Link href={`/super-admin/packages/${p.id}`} className="text-brand-600 hover:text-brand-700">{p.name}</Link>
                    {p.badge && <Badge tone="blue">{p.badge}</Badge>}
                    {p.isTrial && <span className="ml-1 text-xs text-amber-600">trial</span>}
                  </td>
                  <td className="px-4 py-3"><Badge tone={statusTone(p.status)}>{p.status}</Badge></td>
                  <td className="px-4 py-3 capitalize text-slate-500">{p.visibility}</td>
                  <td className="px-4 py-3">{p.currency} {Number(p.price).toLocaleString()}</td>
                  <td className="px-4 py-3 capitalize">{p.billingCycle}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{p.applicableTypes.length ? p.applicableTypes.join(", ") : "all"}</td>
                  <td className="px-4 py-3">{p.maxStudents ?? "∞"}</td>
                  <td className="px-4 py-3">{p.maxStaff ?? "∞"}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/super-admin/packages/${p.id}`} className="text-xs font-medium text-brand-600 hover:text-brand-700">Manage</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <CreatePackageModal
          onClose={() => setCreateOpen(false)}
          onCreated={(msg) => { setCreateOpen(false); setNotice(msg); load(); }}
        />
      )}
      {compareOpen && <CompareModal ids={[...selected]} onClose={() => setCompareOpen(false)} />}
    </>
  );
}

function CreatePackageModal({ onClose, onCreated }: { onClose: () => void; onCreated: (msg: string) => void }) {
  const [form, setForm] = useState({
    name: "", description: "", currency: "INR", price: "0", billingCycle: "annual",
    status: "draft", visibility: "public", badge: "", maxStudents: "", maxStaff: "",
    isTrial: false, trialDays: "",
  });
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await api.post("/packages", {
        name: form.name.trim(),
        description: form.description.trim() || null,
        currency: form.currency.trim() || "INR",
        price: Number(form.price) || 0,
        billingCycle: form.billingCycle,
        status: form.status,
        visibility: form.visibility,
        badge: form.badge.trim() || null,
        maxStudents: num(form.maxStudents),
        maxStaff: num(form.maxStaff),
        applicableTypes: [...types],
        isTrial: form.isTrial,
        trialDays: form.isTrial ? num(form.trialDays) : null,
      });
      onCreated(`Package "${form.name.trim()}" created.`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to create package");
    } finally { setBusy(false); }
  };

  return (
    <Modal title="New package" open onClose={onClose}>
      <div className="space-y-4">
        <Field label="Name"><Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Standard" /></Field>
        <Field label="Description"><Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Price"><Input type="number" min={0} step="0.01" value={form.price} onChange={(e) => set("price", e.target.value)} /></Field>
          <Field label="Currency"><Input value={form.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></Field>
          <Field label="Billing cycle">
            <Select value={form.billingCycle} onChange={(e) => set("billingCycle", e.target.value)}>
              <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Status">
            <Select value={form.status} onChange={(e) => set("status", e.target.value)}>
              <option value="draft">Draft</option><option value="active">Active</option><option value="deprecated">Deprecated</option>
            </Select>
          </Field>
          <Field label="Visibility">
            <Select value={form.visibility} onChange={(e) => set("visibility", e.target.value)}>
              <option value="public">Public</option><option value="internal">Internal</option><option value="hidden">Hidden</option>
            </Select>
          </Field>
          <Field label="Badge"><Input value={form.badge} onChange={(e) => set("badge", e.target.value)} placeholder="Popular" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Max students (blank = ∞)"><Input type="number" min={0} value={form.maxStudents} onChange={(e) => set("maxStudents", e.target.value)} /></Field>
          <Field label="Max staff (blank = ∞)"><Input type="number" min={0} value={form.maxStaff} onChange={(e) => set("maxStaff", e.target.value)} /></Field>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">Applies to (none = all types)</p>
          <div className="flex flex-wrap gap-2">
            {INSTITUTION_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-1 text-sm capitalize">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={types.has(t)}
                  onChange={() => setTypes((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; })} />
                {t}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={form.isTrial} onChange={(e) => set("isTrial", e.target.checked)} />
          Trial package
        </label>
        {form.isTrial && <Field label="Trial days"><Input type="number" min={0} value={form.trialDays} onChange={(e) => set("trialDays", e.target.value)} /></Field>}
        <ErrorNote message={err} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !form.name.trim()}>{busy ? "Saving…" : "Create package"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function CompareModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const [rows, setRows] = useState<Package[] | null>(null);
  useEffect(() => {
    api.get<Package[]>(`/packages-compare?ids=${ids.join(",")}`).then(setRows).catch(() => setRows([]));
  }, [ids]);
  const fields: { label: string; get: (p: Package) => string }[] = useMemo(() => [
    { label: "Status", get: (p) => p.status },
    { label: "Visibility", get: (p) => p.visibility },
    { label: "Price", get: (p) => `${p.currency} ${Number(p.price).toLocaleString()}` },
    { label: "Billing", get: (p) => p.billingCycle },
    { label: "Applies to", get: (p) => (p.applicableTypes.length ? p.applicableTypes.join(", ") : "all") },
    { label: "Max students", get: (p) => (p.maxStudents ?? "∞").toString() },
    { label: "Max staff", get: (p) => (p.maxStaff ?? "∞").toString() },
    { label: "Trial", get: (p) => (p.isTrial ? `${p.trialDays ?? "?"} days` : "no") },
  ], []);
  return (
    <Modal title="Compare packages" open onClose={onClose}>
      {!rows ? <Spinner /> : rows.length === 0 ? <EmptyState message="Nothing to compare." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr><th className="px-2 py-2" />{rows.map((p) => <th key={p.id} className="px-3 py-2 font-semibold text-slate-900">{p.name}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {fields.map((f) => (
                <tr key={f.label}>
                  <td className="px-2 py-2 text-xs uppercase text-slate-400">{f.label}</td>
                  {rows.map((p) => <td key={p.id} className="px-3 py-2 capitalize">{f.get(p)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
