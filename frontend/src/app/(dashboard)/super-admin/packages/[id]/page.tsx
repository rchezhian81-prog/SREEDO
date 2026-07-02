"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Textarea,
} from "@/components/ui";
import { toast } from "@/components/toast";
import { usePlatformGuard } from "../../platform/_guard";

const INSTITUTION_TYPES = ["school", "college", "university", "coaching", "other"] as const;
const BILLING_CYCLES: [string, string][] = [["monthly", "Monthly"], ["quarterly", "Quarterly"], ["half_yearly", "Half-yearly"], ["annual", "Annual"]];
const cycleLabel = (c: string) => BILLING_CYCLES.find(([v]) => v === c)?.[1] ?? c;
const MODULE_GROUPS = [
  "admissions", "students", "staff", "attendance", "fees", "exams", "transport", "hostel",
  "library", "inventory", "communication", "reports", "documents", "certificates", "timetable",
  "hr", "payroll", "parentPortal", "studentPortal", "mobileApp", "apiAccess", "advancedAnalytics",
  "customBranding",
];
const LIMIT_KEYS = [
  "users", "teachers", "parents", "branches", "classes", "storageMb", "documents",
  "smsQuota", "emailQuota", "whatsappQuota", "apiRequests", "reports", "scheduledReports", "supportSessions",
];
const TABS = ["Overview", "Feature Matrix", "Limits", "Tenants", "Usage", "History"] as const;
type Tab = (typeof TABS)[number];

interface Package {
  id: string; name: string; description: string | null; currency: string; price: string | number;
  setupFee: string | number; billingCycle: string; status: string; visibility: string; badge: string | null;
  displayOrder: number; applicableTypes: string[]; maxStudents: number | null; maxStaff: number | null;
  limits: Record<string, number | null>; features: Record<string, unknown>;
  taxPercent: string | number; invoiceDueDays: number | null; paymentTerms: string | null; sacHsn: string | null; taxCategory: string | null;
  billingStartRule: string; autoRenew: boolean; graceDays: number | null;
  isTrial: boolean; trialDays: number | null; trialExpiryBehavior: string | null;
  createdAt: string; updatedAt: string;
}
interface Impact {
  tenants: { id: string; name: string; code: string; institutionType: string; status: string }[];
  activeSubscriptions: number; openInvoices: number;
}

const statusTone = (s: string) => (s === "active" ? "green" : s === "draft" ? "amber" : s === "deprecated" ? "red" : "slate");
const num = (v: string) => (v.trim() === "" ? null : Number(v));

export default function PackageDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { ready, gate } = usePlatformGuard("Package", "Plan administration");
  const [pkg, setPkg] = useState<Package | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setPkg(await api.get<Package>(`/packages/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load package");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  const save = async (patch: Record<string, unknown>, msg: string) => {
    setError(null);
    try {
      setPkg(await api.patch<Package>(`/packages/${id}`, patch));
      toast.success(msg);
    } catch (err) {
      const m = err instanceof ApiError ? err.message : "Failed to save";
      setError(m); toast.error(m);
    }
  };

  if (!ready) return gate;

  return (
    <>
      <nav className="mb-2 text-xs text-slate-400">
        <Link href="/super-admin/packages" className="hover:text-slate-600">Packages</Link> /{" "}
        <span className="text-slate-600">{pkg?.name ?? "…"}</span>
      </nav>
      <PageHeader
        title={pkg?.name ?? "Package"}
        subtitle={pkg ? `${pkg.status} · ${pkg.visibility} · ${pkg.currency} ${Number(pkg.price).toLocaleString()} / ${cycleLabel(pkg.billingCycle)}` : ""}
        action={<Link href="/super-admin/packages"><Button variant="secondary">← Back to packages</Button></Link>}
      />

      {error && <ErrorNote message={error} />}

      {loading || !pkg ? (
        <Spinner />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
            {TABS.map((x) => (
              <button key={x} onClick={() => setTab(x)}
                className={"-mb-px border-b-2 px-3 py-2 text-sm font-medium transition " +
                  (tab === x ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-700")}>
                {x}
              </button>
            ))}
          </div>

          {tab === "Overview" && <OverviewTab key={pkg.updatedAt} pkg={pkg} onSave={save} onStatus={() => load()} onError={setError} onNotice={toast.success} />}
          {tab === "Feature Matrix" && <FeatureMatrixTab pkg={pkg} onSave={save} />}
          {tab === "Limits" && <LimitsTab pkg={pkg} onSave={save} />}
          {tab === "Tenants" && <TenantsTab id={pkg.id} />}
          {tab === "Usage" && <UsageTab id={pkg.id} />}
          {tab === "History" && <HistoryTab id={pkg.id} />}
        </>
      )}
    </>
  );
}

function OverviewTab({ pkg, onSave, onStatus, onError, onNotice }: {
  pkg: Package; onSave: (p: Record<string, unknown>, msg: string) => void;
  onStatus: () => void; onError: (m: string) => void; onNotice: (m: string) => void;
}) {
  const [f, setF] = useState(() => ({
    name: pkg.name, description: pkg.description ?? "", currency: pkg.currency,
    price: String(pkg.price), setupFee: String(pkg.setupFee), billingCycle: pkg.billingCycle,
    visibility: pkg.visibility, badge: pkg.badge ?? "", displayOrder: String(pkg.displayOrder),
    maxStudents: pkg.maxStudents == null ? "" : String(pkg.maxStudents),
    maxStaff: pkg.maxStaff == null ? "" : String(pkg.maxStaff),
    taxPercent: String(pkg.taxPercent), invoiceDueDays: pkg.invoiceDueDays == null ? "" : String(pkg.invoiceDueDays),
    paymentTerms: pkg.paymentTerms ?? "", sacHsn: pkg.sacHsn ?? "", taxCategory: pkg.taxCategory ?? "", billingStartRule: pkg.billingStartRule,
    autoRenew: pkg.autoRenew, graceDays: pkg.graceDays == null ? "" : String(pkg.graceDays),
    isTrial: pkg.isTrial, trialDays: pkg.trialDays == null ? "" : String(pkg.trialDays),
    trialExpiryBehavior: pkg.trialExpiryBehavior ?? "",
  }));
  const [types, setTypes] = useState<Set<string>>(new Set(pkg.applicableTypes));
  const [saving, setSaving] = useState(false);
  const [archive, setArchive] = useState<null | "deprecated" | "archived">(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const [dupOpen, setDupOpen] = useState(false);
  const [dupName, setDupName] = useState("");
  const [dupBusy, setDupBusy] = useState(false);
  const set = (k: string, v: unknown) => setF((s) => ({ ...s, [k]: v }));

  const openDuplicate = () => { setDupName(`${pkg.name} (copy)`); setDupOpen(true); };
  const confirmDuplicate = async () => {
    setDupBusy(true);
    try {
      const created = await api.post<Package>(`/packages/${pkg.id}/duplicate`, { name: dupName.trim() });
      setDupOpen(false);
      onNotice("Package duplicated — opening the new draft.");
      router.push(`/super-admin/packages/${created.id}`);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to duplicate package");
    } finally { setDupBusy(false); }
  };

  const submit = async () => {
    setSaving(true);
    await onSave({
      name: f.name.trim(), description: f.description.trim() || null, currency: f.currency.trim() || "INR",
      price: Number(f.price) || 0, setupFee: Number(f.setupFee) || 0, billingCycle: f.billingCycle,
      visibility: f.visibility, badge: f.badge.trim() || null, displayOrder: Number(f.displayOrder) || 0,
      applicableTypes: [...types], maxStudents: num(f.maxStudents), maxStaff: num(f.maxStaff),
      taxPercent: Number(f.taxPercent) || 0, invoiceDueDays: num(f.invoiceDueDays),
      paymentTerms: f.paymentTerms.trim() || null, sacHsn: f.sacHsn.trim() || null, taxCategory: f.taxCategory.trim() || null,
      billingStartRule: f.billingStartRule, autoRenew: f.autoRenew, graceDays: num(f.graceDays),
      isTrial: f.isTrial, trialDays: f.isTrial ? num(f.trialDays) : null,
      trialExpiryBehavior: f.trialExpiryBehavior || null,
    }, "Package saved.");
    setSaving(false);
  };

  const openArchive = async (target: "deprecated" | "archived") => {
    setReason("");
    setImpact(null);
    setArchive(target);
    try { setImpact(await api.get<Impact>(`/packages/${pkg.id}/impact`)); } catch { /* show without impact */ }
  };
  const confirmStatus = async () => {
    if (!archive) return;
    setBusy(true);
    try {
      await api.post(`/packages/${pkg.id}/status`, { status: archive, reason });
      setArchive(null);
      onNotice(`Package ${archive}.`);
      onStatus();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Status change failed");
    } finally { setBusy(false); }
  };
  const setActive = async () => {
    try { await api.post(`/packages/${pkg.id}/status`, { status: "active" }); onNotice("Package activated."); onStatus(); }
    catch (err) { onError(err instanceof ApiError ? err.message : "Failed"); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name"><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Badge"><Input value={f.badge} onChange={(e) => set("badge", e.target.value)} placeholder="Popular / Recommended" /></Field>
        </div>
        <div className="mt-4"><Field label="Description"><Textarea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field></div>
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Pricing & billing</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Price"><Input type="number" min={0} step="0.01" value={f.price} onChange={(e) => set("price", e.target.value)} /></Field>
          <Field label="Currency"><Input value={f.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></Field>
          <Field label="Billing cycle">
            <Select value={f.billingCycle} onChange={(e) => set("billingCycle", e.target.value)}>
              {BILLING_CYCLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Setup fee"><Input type="number" min={0} step="0.01" value={f.setupFee} onChange={(e) => set("setupFee", e.target.value)} /></Field>
          <Field label="Tax % (flat)"><Input type="number" min={0} step="0.01" value={f.taxPercent} onChange={(e) => set("taxPercent", e.target.value)} /></Field>
          <Field label="SAC / HSN"><Input value={f.sacHsn} onChange={(e) => set("sacHsn", e.target.value)} /></Field>
          <Field label="Tax category"><Input value={f.taxCategory} onChange={(e) => set("taxCategory", e.target.value)} placeholder="standard / exempt / zero-rated" /></Field>
          <Field label="Invoice due days"><Input type="number" min={0} value={f.invoiceDueDays} onChange={(e) => set("invoiceDueDays", e.target.value)} /></Field>
          <Field label="Grace days"><Input type="number" min={0} value={f.graceDays} onChange={(e) => set("graceDays", e.target.value)} /></Field>
          <Field label="Billing start">
            <Select value={f.billingStartRule} onChange={(e) => set("billingStartRule", e.target.value)}>
              <option value="immediate">Immediate</option><option value="after_trial">After trial</option><option value="custom">Custom</option>
            </Select>
          </Field>
        </div>
        <div className="mt-4"><Field label="Payment terms"><Input value={f.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} placeholder="Net 15, advance, …" /></Field></div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={f.autoRenew} onChange={(e) => set("autoRenew", e.target.checked)} />
          Auto-renew
        </label>
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Limits & applicability</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Max students (∞ if blank)"><Input type="number" min={0} value={f.maxStudents} onChange={(e) => set("maxStudents", e.target.value)} /></Field>
          <Field label="Max staff (∞ if blank)"><Input type="number" min={0} value={f.maxStaff} onChange={(e) => set("maxStaff", e.target.value)} /></Field>
          <Field label="Display order"><Input type="number" value={f.displayOrder} onChange={(e) => set("displayOrder", e.target.value)} /></Field>
          <Field label="Visibility">
            <Select value={f.visibility} onChange={(e) => set("visibility", e.target.value)}>
              <option value="public">Public</option><option value="internal">Internal</option><option value="hidden">Hidden</option>
            </Select>
          </Field>
        </div>
        <div className="mt-3">
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
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Trial</h3>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={f.isTrial} onChange={(e) => set("isTrial", e.target.checked)} />
          This is a trial package
        </label>
        {f.isTrial && (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Trial days"><Input type="number" min={0} value={f.trialDays} onChange={(e) => set("trialDays", e.target.value)} /></Field>
            <Field label="On trial expiry">
              <Select value={f.trialExpiryBehavior} onChange={(e) => set("trialExpiryBehavior", e.target.value)}>
                <option value="">—</option><option value="expire">Expire</option><option value="suspend">Suspend</option><option value="convert_manual">Convert manually</option>
              </Select>
            </Field>
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
        <div className="flex-1" />
        <Badge tone={statusTone(pkg.status)}>{pkg.status}</Badge>
        <Button variant="secondary" onClick={openDuplicate}>Duplicate</Button>
        {pkg.status !== "active" && <Button variant="secondary" onClick={setActive}>Set active</Button>}
        {pkg.status !== "deprecated" && <Button variant="secondary" onClick={() => openArchive("deprecated")}>Deprecate</Button>}
        {pkg.status !== "archived" && <Button variant="danger" onClick={() => openArchive("archived")}>Archive</Button>}
      </div>

      <ConfirmDialog
        open={dupOpen}
        title="Duplicate package"
        tone="primary"
        confirmLabel="Duplicate"
        busy={dupBusy}
        confirmDisabled={!dupName.trim()}
        message={
          <div className="space-y-2 text-sm">
            <p>Copies every setting from <strong>{pkg.name}</strong> into a new package. The copy starts as a <strong>draft</strong> (internal) so you can review it before publishing.</p>
            <Field label="New package name"><Input value={dupName} onChange={(e) => setDupName(e.target.value)} placeholder="Name for the copy" /></Field>
          </div>
        }
        onConfirm={confirmDuplicate}
        onClose={() => setDupOpen(false)}
      />

      <ConfirmDialog
        open={!!archive}
        title={archive === "archived" ? "Archive package?" : "Deprecate package?"}
        tone="danger"
        confirmLabel={archive === "archived" ? "Archive" : "Deprecate"}
        busy={busy}
        confirmDisabled={!reason.trim()}
        message={
          <div className="space-y-2 text-sm">
            <p>{archive === "archived" ? "Archiving hides this package from new assignments. It is never hard-deleted, and existing subscriptions keep working." : "Deprecating marks this plan as no longer offered."}</p>
            {impact && (
              <p className="text-slate-600">
                Impact: <strong>{impact.tenants.length}</strong> tenant(s) currently on this package · {impact.activeSubscriptions} active subscription(s) · {impact.openInvoices} open invoice(s).
              </p>
            )}
            <Field label="Reason (required)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why?" /></Field>
          </div>
        }
        onConfirm={() => { if (reason.trim()) confirmStatus(); }}
        onClose={() => setArchive(null)}
      />
    </div>
  );
}

function FeatureMatrixTab({ pkg, onSave }: { pkg: Package; onSave: (p: Record<string, unknown>, msg: string) => void }) {
  const features = (pkg.features ?? {}) as { modules?: Record<string, boolean>; supportLevel?: string };
  const [modules, setModules] = useState<Record<string, boolean>>(() => ({ ...(features.modules ?? {}) }));
  const [supportLevel, setSupportLevel] = useState(features.supportLevel ?? "standard");
  const [saving, setSaving] = useState(false);
  const toggle = (k: string) => setModules((m) => ({ ...m, [k]: !m[k] }));

  const submit = async () => {
    setSaving(true);
    await onSave({ features: { ...(pkg.features ?? {}), modules, supportLevel } }, "Feature matrix saved.");
    setSaving(false);
  };

  return (
    <Card>
      <p className="mb-3 text-xs text-slate-400">Toggle modules/features included in this package. These guide each tenant&apos;s enabled modules (tenant settings remain the source of truth per tenant).</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {MODULE_GROUPS.map((k) => (
          <label key={k} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
            <span className="capitalize">{k.replace(/([A-Z])/g, " $1")}</span>
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={!!modules[k]} onChange={() => toggle(k)} />
          </label>
        ))}
      </div>
      <div className="mt-4 max-w-xs">
        <Field label="Support level">
          <Select value={supportLevel} onChange={(e) => setSupportLevel(e.target.value)}>
            <option value="basic">Basic</option><option value="standard">Standard</option><option value="priority">Priority</option><option value="dedicated">Dedicated</option>
          </Select>
        </Field>
      </div>
      <div className="mt-4"><Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save feature matrix"}</Button></div>
    </Card>
  );
}

function LimitsTab({ pkg, onSave }: { pkg: Package; onSave: (p: Record<string, unknown>, msg: string) => void }) {
  const [maxStudents, setMaxStudents] = useState(pkg.maxStudents == null ? "" : String(pkg.maxStudents));
  const [maxStaff, setMaxStaff] = useState(pkg.maxStaff == null ? "" : String(pkg.maxStaff));
  const [limits, setLimits] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const k of LIMIT_KEYS) { const v = (pkg.limits ?? {})[k]; o[k] = v == null ? "" : String(v); }
    return o;
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    const out: Record<string, number | null> = {};
    for (const k of LIMIT_KEYS) out[k] = limits[k].trim() === "" ? null : Number(limits[k]);
    await onSave({ maxStudents: num(maxStudents), maxStaff: num(maxStaff), limits: out }, "Limits saved.");
    setSaving(false);
  };

  return (
    <Card>
      <p className="mb-3 text-xs text-slate-400">Blank = unlimited (∞). Package caps cascade to a tenant unless overridden per tenant.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Students"><Input type="number" min={0} value={maxStudents} onChange={(e) => setMaxStudents(e.target.value)} placeholder="∞" /></Field>
        <Field label="Staff"><Input type="number" min={0} value={maxStaff} onChange={(e) => setMaxStaff(e.target.value)} placeholder="∞" /></Field>
        {LIMIT_KEYS.map((k) => (
          <Field key={k} label={k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}>
            <Input type="number" min={0} value={limits[k]} placeholder="∞" onChange={(e) => setLimits((s) => ({ ...s, [k]: e.target.value }))} />
          </Field>
        ))}
      </div>
      <div className="mt-4"><Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save limits"}</Button></div>
    </Card>
  );
}

function TenantsTab({ id }: { id: string }) {
  const [impact, setImpact] = useState<Impact | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get<Impact>(`/packages/${id}/impact`).then(setImpact).catch((e) => setError(e instanceof ApiError ? e.message : "Failed"));
  }, [id]);
  if (error) return <ErrorNote message={error} />;
  if (!impact) return <Spinner />;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card><div className="text-xs uppercase text-slate-400">Tenants on this package</div><div className="text-2xl font-bold">{impact.tenants.length}</div></Card>
        <Card><div className="text-xs uppercase text-slate-400">Active subscriptions</div><div className="text-2xl font-bold">{impact.activeSubscriptions}</div></Card>
        <Card><div className="text-xs uppercase text-slate-400">Open invoices</div><div className="text-2xl font-bold">{impact.openInvoices}</div></Card>
      </div>
      {impact.tenants.length === 0 ? <EmptyState message="No tenants are on this package." /> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Tenant</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {impact.tenants.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{t.name} <span className="font-mono text-xs text-slate-400">{t.code}</span></td>
                  <td className="px-4 py-3 capitalize">{t.institutionType}</td>
                  <td className="px-4 py-3"><Badge tone="slate">{t.status}</Badge></td>
                  <td className="px-4 py-3 text-right"><Link href={`/super-admin/platform/tenants/${t.id}`} className="text-xs font-medium text-brand-600 hover:text-brand-700">Open tenant →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function UsageTab({ id }: { id: string }) {
  const [row, setRow] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get<Record<string, unknown>[]>(`/packages-report?packageId=${id}`)
      .then((r) => setRow(r[0] ?? null)).catch((e) => setError(e instanceof ApiError ? e.message : "Failed"));
  }, [id]);
  if (error) return <ErrorNote message={error} />;
  if (!row) return <Spinner />;
  const cell = (k: string) => String(row[k] ?? "0");
  const items: [string, string][] = [
    ["Tenants", cell("tenants")], ["Active", cell("active")], ["Trial", cell("trial")],
    ["Suspended", cell("suspended")], ["Expired", cell("expired")],
    ["Students", cell("students")], ["Staff", cell("staff")],
    ["Revenue (paid)", cell("revenue")], ["Outstanding", cell("outstanding")], ["Overdue", cell("overdue")],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {items.map(([label, value]) => (
        <Card key={label}><div className="text-xs uppercase text-slate-400">{label}</div><div className="text-xl font-bold">{value}</div></Card>
      ))}
    </div>
  );
}

function HistoryTab({ id }: { id: string }) {
  const [rows, setRows] = useState<{ id: string; versionNo: number; action: string; diff: Record<string, { from: unknown; to: unknown }>; actorEmail: string | null; reason: string | null; createdAt: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get<typeof rows>(`/packages/${id}/history`).then((r) => setRows(r ?? [])).catch((e) => setError(e instanceof ApiError ? e.message : "Failed"));
  }, [id]);
  if (error) return <ErrorNote message={error} />;
  if (!rows) return <Spinner />;
  if (rows.length === 0) return <EmptyState message="No changes recorded yet." />;
  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const keys = Object.keys(r.diff ?? {});
        return (
          <Card key={r.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-slate-900">v{r.versionNo} · {r.action}</span>
              <span className="text-xs text-slate-400">{r.createdAt?.slice(0, 16).replace("T", " ")} · {r.actorEmail ?? "system"}</span>
            </div>
            {r.reason && <p className="mt-1 text-xs text-slate-500">Reason: {r.reason}</p>}
            {keys.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs">
                {keys.map((k) => (
                  <li key={k} className="font-mono text-slate-600">
                    <span className="text-slate-500">{k}:</span>{" "}
                    <span className="text-red-500 line-through">{JSON.stringify(r.diff[k].from)}</span>{" → "}
                    <span className="text-emerald-600">{JSON.stringify(r.diff[k].to)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}
