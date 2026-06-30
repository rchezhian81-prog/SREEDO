"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import {
  Badge, Button, ConfirmDialog, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Textarea,
} from "@/components/ui";
import { toast } from "@/components/toast";
import { usePlatformGuard } from "../platform/_guard";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const INSTITUTION_TYPES = ["school", "college", "university", "coaching", "other"] as const;
const BILLING_CYCLES: [string, string][] = [["monthly", "Monthly"], ["quarterly", "Quarterly"], ["half_yearly", "Half-yearly"], ["annual", "Annual"]];

interface Coupon {
  id: string; code: string; name: string | null; description: string | null;
  discountType: "percentage" | "fixed"; discountValue: string | number;
  maxDiscountAmount: string | number | null; minInvoiceAmount: string | number | null;
  validFrom: string | null; validUntil: string | null;
  totalUsageLimit: number | null; perTenantUsageLimit: number | null;
  applicablePackages: string[]; applicableTypes: string[]; applicableBillingCycles: string[];
  status: "draft" | "active" | "expired" | "disabled"; internalNotes: string | null;
  usedCount?: number;
}

const statusTone = (s: string) => (s === "active" ? "green" : s === "draft" ? "amber" : s === "expired" ? "slate" : "red");
const fmtDiscount = (c: Coupon) => (c.discountType === "percentage" ? `${Number(c.discountValue)}%` : `₹${Number(c.discountValue).toLocaleString()}`);

function authToken() { return useAuthStore.getState().accessToken; }
async function downloadFile(path: string, filename: string) {
  const res = await fetch(`${API_URL}${path}`, { headers: authToken() ? { Authorization: `Bearer ${authToken()}` } : {} });
  if (!res.ok) throw new Error("Download failed");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function CouponsPage() {
  const { ready, gate } = usePlatformGuard("Coupons", "Promotions & discounts");
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [packages, setPackages] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Coupon | null | "new">(null);
  const [usageFor, setUsageFor] = useState<Coupon | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      if (status) p.set("status", status);
      setCoupons(await api.get<Coupon[]>(`/platform/coupons?${p.toString()}`));
    } catch (err) { setCoupons([]); setError(err instanceof ApiError ? err.message : "Failed to load coupons"); }
    finally { setLoading(false); }
  }, [q, status]);

  useEffect(() => { if (ready) load(); }, [ready, load]);
  useEffect(() => { if (ready) api.get<{ id: string; name: string }[]>("/packages").then(setPackages).catch(() => setPackages([])); }, [ready]);

  if (!ready) return gate;

  return (
    <>
      <PageHeader
        title="Coupons & promotions"
        subtitle="Super-admin discount codes applied before an invoice is issued"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => downloadFile("/platform/coupons-usage-report?format=csv", "coupon-usage.csv").catch(() => setError("Export failed"))}>Export usage CSV</Button>
            <Button onClick={() => setEditing("new")}>+ New coupon</Button>
          </div>
        }
      />
      {error && <ErrorNote message={error} />}
      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <Input placeholder="Search code / name…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {["draft", "active", "expired", "disabled"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </Select>
      </div>

      {loading ? <Spinner /> : coupons.length === 0 ? (
        <EmptyState message={q || status ? "No coupons match these filters." : "No coupons yet. Create one to get started."} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Code</th><th className="px-4 py-3">Discount</th><th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Valid</th><th className="px-4 py-3">Used</th><th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {coupons.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{c.code}{c.name && <div className="text-xs font-normal text-slate-400">{c.name}</div>}</td>
                  <td className="px-4 py-3">{fmtDiscount(c)}</td>
                  <td className="px-4 py-3"><Badge tone={statusTone(c.status)}>{c.status}</Badge></td>
                  <td className="px-4 py-3 text-xs text-slate-500">{c.validFrom || "—"} → {c.validUntil || "∞"}</td>
                  <td className="px-4 py-3">{c.usedCount ?? 0}{c.totalUsageLimit != null ? ` / ${c.totalUsageLimit}` : ""}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setUsageFor(c)} className="mr-3 text-xs font-medium text-slate-500 hover:text-slate-700">Usage</button>
                    <button onClick={() => setEditing(c)} className="text-xs font-medium text-brand-600 hover:text-brand-700">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <CouponModal coupon={editing === "new" ? null : editing} packages={packages}
          onClose={() => setEditing(null)} onSaved={(msg) => { setEditing(null); toast.success(msg); load(); }} onError={setError} />
      )}
      {usageFor && <UsageModal coupon={usageFor} onClose={() => setUsageFor(null)} />}
    </>
  );
}

function CouponModal({ coupon, packages, onClose, onSaved, onError }: {
  coupon: Coupon | null; packages: { id: string; name: string }[];
  onClose: () => void; onSaved: (msg: string) => void; onError: (m: string) => void;
}) {
  const isNew = !coupon;
  const [f, setF] = useState(() => ({
    code: coupon?.code ?? "", name: coupon?.name ?? "", description: coupon?.description ?? "",
    discountType: coupon?.discountType ?? "percentage", discountValue: String(coupon?.discountValue ?? ""),
    maxDiscountAmount: coupon?.maxDiscountAmount == null ? "" : String(coupon.maxDiscountAmount),
    minInvoiceAmount: coupon?.minInvoiceAmount == null ? "" : String(coupon.minInvoiceAmount),
    validFrom: coupon?.validFrom ?? "", validUntil: coupon?.validUntil ?? "",
    totalUsageLimit: coupon?.totalUsageLimit == null ? "" : String(coupon.totalUsageLimit),
    perTenantUsageLimit: coupon?.perTenantUsageLimit == null ? "" : String(coupon.perTenantUsageLimit),
    status: coupon?.status ?? "draft", internalNotes: coupon?.internalNotes ?? "",
  }));
  const [types, setTypes] = useState<Set<string>>(new Set(coupon?.applicableTypes ?? []));
  const [cycles, setCycles] = useState<Set<string>>(new Set(coupon?.applicableBillingCycles ?? []));
  const [pkgs, setPkgs] = useState<Set<string>>(new Set(coupon?.applicablePackages ?? []));
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF((s) => ({ ...s, [k]: v }));
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const submit = async () => {
    setBusy(true);
    const body: Record<string, unknown> = {
      code: f.code.trim(), name: f.name.trim() || null, description: f.description.trim() || null,
      discountType: f.discountType, discountValue: Number(f.discountValue) || 0,
      maxDiscountAmount: num(f.maxDiscountAmount), minInvoiceAmount: num(f.minInvoiceAmount),
      validFrom: f.validFrom || null, validUntil: f.validUntil || null,
      totalUsageLimit: num(f.totalUsageLimit), perTenantUsageLimit: num(f.perTenantUsageLimit),
      applicableTypes: [...types], applicableBillingCycles: [...cycles], applicablePackages: [...pkgs],
      internalNotes: f.internalNotes.trim() || null,
    };
    if (isNew) body.status = f.status;
    try {
      if (isNew) await api.post("/platform/coupons", body);
      else await api.patch(`/platform/coupons/${coupon!.id}`, body);
      onSaved(`Coupon "${f.code.trim().toUpperCase()}" ${isNew ? "created" : "saved"}.`);
    } catch (e) { onError(e instanceof ApiError ? e.message : "Failed to save coupon"); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={isNew ? "New coupon" : `Edit ${coupon!.code}`} open onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code"><Input value={f.code} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="WELCOME10" /></Field>
          <Field label="Name"><Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Welcome offer" /></Field>
        </div>
        <Field label="Description"><Textarea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Discount type">
            <Select value={f.discountType} onChange={(e) => set("discountType", e.target.value)}>
              <option value="percentage">Percentage</option><option value="fixed">Fixed amount</option>
            </Select>
          </Field>
          <Field label={f.discountType === "percentage" ? "Percent (0-100)" : "Amount"}><Input type="number" min={0} value={f.discountValue} onChange={(e) => set("discountValue", e.target.value)} /></Field>
          <Field label="Max discount (cap)"><Input type="number" min={0} value={f.maxDiscountAmount} onChange={(e) => set("maxDiscountAmount", e.target.value)} placeholder="for %" /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Min invoice amount"><Input type="number" min={0} value={f.minInvoiceAmount} onChange={(e) => set("minInvoiceAmount", e.target.value)} /></Field>
          <Field label="Valid from"><Input type="date" value={f.validFrom} onChange={(e) => set("validFrom", e.target.value)} /></Field>
          <Field label="Valid until"><Input type="date" value={f.validUntil} onChange={(e) => set("validUntil", e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Total usage limit (∞ blank)"><Input type="number" min={0} value={f.totalUsageLimit} onChange={(e) => set("totalUsageLimit", e.target.value)} /></Field>
          <Field label="Per-tenant limit (∞ blank)"><Input type="number" min={0} value={f.perTenantUsageLimit} onChange={(e) => set("perTenantUsageLimit", e.target.value)} /></Field>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">Applies to institution types (none = all)</p>
          <div className="flex flex-wrap gap-2">
            {INSTITUTION_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-1 text-sm capitalize">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={types.has(t)}
                  onChange={() => setTypes((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; })} />{t}
              </label>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">Applies to billing cycles (none = all)</p>
          <div className="flex flex-wrap gap-2">
            {BILLING_CYCLES.map(([v, l]) => (
              <label key={v} className="flex items-center gap-1 text-sm">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={cycles.has(v)}
                  onChange={() => setCycles((s) => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n; })} />{l}
              </label>
            ))}
          </div>
        </div>
        {packages.length > 0 && (
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">Applies to packages (none = all)</p>
            <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto rounded-lg border border-slate-100 p-2">
              {packages.map((p) => (
                <label key={p.id} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={pkgs.has(p.id)}
                    onChange={() => setPkgs((s) => { const n = new Set(s); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })} />{p.name}
                </label>
              ))}
            </div>
          </div>
        )}
        {isNew && (
          <Field label="Status">
            <Select value={f.status} onChange={(e) => set("status", e.target.value)}>
              <option value="draft">Draft</option><option value="active">Active</option><option value="disabled">Disabled</option>
            </Select>
          </Field>
        )}
        <Field label="Internal notes"><Textarea rows={2} value={f.internalNotes} onChange={(e) => set("internalNotes", e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !f.code.trim() || !f.discountValue}>{busy ? "Saving…" : isNew ? "Create coupon" : "Save changes"}</Button>
        </div>
        {!isNew && <CouponStatusActions coupon={coupon!} onChanged={(msg) => onSaved(msg)} onError={onError} />}
      </div>
    </Modal>
  );
}

function CouponStatusActions({ coupon, onChanged, onError }: { coupon: Coupon; onChanged: (m: string) => void; onError: (m: string) => void }) {
  const [target, setTarget] = useState<null | "active" | "disabled" | "expired">(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const needsReason = target === "disabled" || target === "expired";
  const go = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await api.post(`/platform/coupons/${coupon.id}/status`, { status: target, reason: reason.trim() || undefined });
      setTarget(null); onChanged(`Coupon ${target}.`);
    } catch (e) { onError(e instanceof ApiError ? e.message : "Status change failed"); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
      <span className="text-xs uppercase text-slate-400">Status:</span>
      {coupon.status !== "active" && <Button variant="secondary" onClick={() => { setReason(""); setTarget("active"); }}>Activate</Button>}
      {coupon.status !== "disabled" && <Button variant="secondary" onClick={() => { setReason(""); setTarget("disabled"); }}>Disable</Button>}
      {coupon.status !== "expired" && <Button variant="secondary" onClick={() => { setReason(""); setTarget("expired"); }}>Expire</Button>}
      <ConfirmDialog
        open={!!target}
        title={`Set coupon to ${target}?`}
        tone={target === "active" ? "primary" : "danger"}
        confirmLabel={target === "active" ? "Activate" : "Confirm"}
        busy={busy}
        confirmDisabled={needsReason && !reason.trim()}
        message={
          <div className="space-y-2 text-sm">
            <p>Change <strong>{coupon.code}</strong> to <strong>{target}</strong>.</p>
            {needsReason && <Field label="Reason (required)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why?" /></Field>}
          </div>
        }
        onConfirm={() => { if (!needsReason || reason.trim()) go(); }}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}

function UsageModal({ coupon, onClose }: { coupon: Coupon; onClose: () => void }) {
  const [data, setData] = useState<{ redemptions: { id: string; invoiceNumber: string | null; institutionName: string | null; discountAmount: string; redeemedAt: string }[]; used: number; totalDiscount: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get<typeof data>(`/platform/coupons/${coupon.id}/usage`).then(setData).catch((e) => setError(e instanceof ApiError ? e.message : "Failed"));
  }, [coupon.id]);
  return (
    <Modal title={`Usage — ${coupon.code}`} open onClose={onClose}>
      {error ? <ErrorNote message={error} /> : !data ? <Spinner /> : (
        <div className="space-y-3">
          <div className="flex gap-6 text-sm">
            <div><div className="text-xs uppercase text-slate-400">Times used</div><div className="text-xl font-bold">{data.used}</div></div>
            <div><div className="text-xs uppercase text-slate-400">Total discount</div><div className="text-xl font-bold">₹{Number(data.totalDiscount).toLocaleString()}</div></div>
          </div>
          {data.redemptions.length === 0 ? <EmptyState message="Not redeemed yet." /> : (
            <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-100">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Tenant</th><th className="px-3 py-2">Discount</th><th className="px-3 py-2">When</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.redemptions.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2">{r.invoiceNumber ?? "—"}</td>
                      <td className="px-3 py-2">{r.institutionName ?? "—"}</td>
                      <td className="px-3 py-2">₹{Number(r.discountAmount).toLocaleString()}</td>
                      <td className="px-3 py-2 text-xs text-slate-400">{r.redeemedAt?.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
