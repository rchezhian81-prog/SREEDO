"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Select, Spinner, Textarea } from "@/components/ui";
import { usePlatformGuard } from "../../_guard";
import { formatNumber, limitLabel } from "../../_utils";

interface Tenant {
  id: string; name: string; code: string; type: "school" | "college"; institutionType: string;
  isActive: boolean; status: string; slug: string | null;
  legalName: string | null; shortName: string | null; address: string | null; city: string | null;
  state: string | null; country: string | null; pincode: string | null; phone: string | null;
  email: string | null; website: string | null; academicYear: string | null; timezone: string | null;
  currency: string | null; language: string | null; notes: string | null;
  settings: Record<string, unknown>;
  termsAccepted: boolean; agreementSigned: boolean; kycStatus: string; approvalStatus: string;
  approvalRemarks: string | null; approvedAt: string | null;
  usage: Record<string, number>;
  limits: Record<string, number | null | string>;
  billing: { total: number; issued: number; paid: number; outstanding: string; overdueCount: number; latest: Record<string, unknown> | null; subscription: Record<string, unknown> | null };
  admins: { id: string; fullName: string; email: string; isActive: boolean }[];
  recentActivity: { action: string; actorEmail: string | null; createdAt: string; ip: string | null }[];
  onboardingProgress: { steps: { key: string; label: string; done: boolean }[]; completion: number; completedAt: string | null };
}

const TABS = ["Overview", "Profile", "Academic & Settings", "Modules", "Subscription & Billing", "Limits & Usage", "Branding & Domain", "Onboarding", "Compliance", "Admins", "Notes", "Audit"] as const;
type Tab = (typeof TABS)[number];

const MODULE_KEYS = ["admissions", "students", "staff", "attendance", "fees", "exams", "transport", "hostel", "library", "inventory", "communication", "reports", "documents", "certificates", "timetable", "payroll", "hr"];
const statusTone = (s: string) =>
  s === "active" ? "green" : s === "trial" ? "blue" : s === "suspended" || s === "expired" ? "red" : s === "archived" ? "slate" : "amber";

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { ready, gate } = usePlatformGuard("Tenant", "Institution management");
  const [t, setT] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("Overview");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setT(await api.get<Tenant>(`/platform/tenants/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load tenant");
    } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { if (ready) load(); }, [ready, load]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); await load(); if (ok) setNotice(ok); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Action failed"); }
    finally { setBusy(false); }
  };

  const lifecycle = (status: string) => {
    let reason: string | undefined;
    if (status === "suspended" || status === "archived") {
      const r = window.prompt(`Reason to ${status === "archived" ? "archive" : "suspend"} this tenant (recorded in audit):`);
      if (r === null) return;
      reason = r;
    }
    act(() => api.post(`/platform/tenants/${id}/lifecycle`, { status, reason }), `Tenant ${status}.`);
  };

  if (!ready) return gate;
  if (loading) return <Spinner />;
  if (error && !t) return <ErrorNote message={error} />;
  if (!t) return <ErrorNote message="Tenant not found" />;

  return (
    <>
      <nav className="mb-2 text-xs text-slate-400">
        <Link href="/super-admin/platform" className="hover:text-slate-600">Platform</Link> /{" "}
        <Link href="/super-admin/platform/tenants" className="hover:text-slate-600">Tenants</Link> /{" "}
        <span className="text-slate-600">{t.code}</span>
      </nav>
      <PageHeader
        title={t.name}
        subtitle={`${t.code} · ${t.institutionType}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(t.status)}>{t.status}</Badge>
            {t.status !== "active" && <Button variant="secondary" onClick={() => lifecycle("active")} disabled={busy}>Activate</Button>}
            {t.status === "active" && <Button variant="secondary" onClick={() => lifecycle("suspended")} disabled={busy}>Suspend</Button>}
            {(t.status === "suspended" || t.status === "expired") && <Button variant="secondary" onClick={() => lifecycle("active")} disabled={busy}>Reactivate</Button>}
            {t.status !== "archived" && <Button variant="danger" onClick={() => lifecycle("archived")} disabled={busy}>Archive</Button>}
            <Link href="/super-admin/platform/support"><Button variant="secondary">Support access</Button></Link>
          </div>
        }
      />
      {error && <ErrorNote message={error} />}
      {notice && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>}

      {/* Tab bar */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((x) => (
          <button key={x} onClick={() => setTab(x)}
            className={`px-3 py-2 text-sm font-medium ${tab === x ? "border-b-2 border-brand-600 text-brand-700" : "text-slate-500 hover:text-slate-700"}`}>
            {x}
          </button>
        ))}
      </div>

      {tab === "Overview" && <OverviewTab t={t} />}
      {tab === "Profile" && <ProfileTab t={t} busy={busy} onSave={(body) => act(() => api.patch(`/platform/tenants/${id}`, body), "Profile saved.")} />}
      {tab === "Academic & Settings" && <SettingsTab t={t} busy={busy} onSave={(body) => act(() => api.patch(`/platform/tenants/${id}/settings`, body), "Settings saved.")} />}
      {tab === "Modules" && <ModulesTab t={t} busy={busy} onSave={(enabledModules) => act(() => api.patch(`/platform/tenants/${id}/settings`, { enabledModules }), "Modules saved.")} />}
      {tab === "Subscription & Billing" && <BillingTab t={t} />}
      {tab === "Limits & Usage" && <LimitsTab t={t} />}
      {tab === "Branding & Domain" && <BrandingTab t={t} busy={busy} onSave={(slug) => act(() => api.patch(`/platform/tenants/${id}`, { slug }), "Slug saved.")} />}
      {tab === "Onboarding" && <OnboardingTab t={t} busy={busy}
        onStep={(step, done) => act(() => api.post(`/platform/tenants/${id}/onboarding/step`, { step, done }))}
        onComplete={() => act(() => api.post(`/platform/tenants/${id}/onboarding/complete`), "Onboarding completed.")} />}
      {tab === "Compliance" && <ComplianceTab t={t} busy={busy} onSave={(body) => act(() => api.patch(`/platform/tenants/${id}/compliance`, body), "Compliance saved.")} />}
      {tab === "Admins" && <AdminsTab t={t} busy={busy}
        onAdd={(body) => act(() => api.post(`/platform/tenants/${id}/admin`, body), "Admin added.")}
        onToggle={(uid, active) => act(() => api.patch(`/platform/tenants/${id}/admin/${uid}`, { active }))} />}
      {tab === "Notes" && <NotesTab id={id} />}
      {tab === "Audit" && <AuditTab t={t} />}
    </>
  );
}

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function OverviewTab({ t }: { t: Tenant }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Type" value={t.institutionType} hint={`structural: ${t.type}`} />
        <Tile label="Students" value={formatNumber(t.usage.students)} />
        <Tile label="Staff" value={formatNumber(t.usage.staff)} />
        <Tile label="Users" value={formatNumber(t.usage.users)} />
        <Tile label="Active sessions" value={formatNumber(t.usage.activeSessions)} />
        <Tile label="Outstanding" value={`${t.currency ?? "INR"} ${Number(t.billing.outstanding).toFixed(2)}`} hint={`${t.billing.overdueCount} overdue`} />
        <Tile label="Onboarding" value={`${t.onboardingProgress.completion}%`} />
        <Tile label="Package" value={(t.billing.subscription?.packageName as string) ?? "—"} />
      </div>
      <Card>
        <p className="mb-2 text-sm font-medium text-slate-700">Contact</p>
        <div className="grid grid-cols-2 gap-2 text-sm text-slate-600">
          <div>Email: {t.email ?? "—"}</div><div>Phone: {t.phone ?? "—"}</div>
          <div>Website: {t.website ?? "—"}</div><div>Slug: {t.slug ?? "—"}</div>
          <div className="col-span-2">Address: {[t.address, t.city, t.state, t.country, t.pincode].filter(Boolean).join(", ") || "—"}</div>
        </div>
      </Card>
    </div>
  );
}

function ProfileTab({ t, busy, onSave }: { t: Tenant; busy: boolean; onSave: (b: Record<string, unknown>) => void }) {
  const [f, setF] = useState({
    name: t.name, institutionType: t.institutionType, legalName: t.legalName ?? "", shortName: t.shortName ?? "",
    email: t.email ?? "", phone: t.phone ?? "", website: t.website ?? "", address: t.address ?? "",
    city: t.city ?? "", state: t.state ?? "", country: t.country ?? "", pincode: t.pincode ?? "",
    academicYear: t.academicYear ?? "", currency: t.currency ?? "", language: t.language ?? "", notes: t.notes ?? "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const blank = (v: string) => (v.trim() === "" ? null : v.trim());
  return (
    <Card>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name"><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Institution type">
          <Select value={f.institutionType} onChange={(e) => set("institutionType", e.target.value)}>
            {["school", "college", "university", "coaching", "other"].map((x) => <option key={x} value={x}>{x}</option>)}
          </Select>
        </Field>
        <Field label="Legal name"><Input value={f.legalName} onChange={(e) => set("legalName", e.target.value)} /></Field>
        <Field label="Short name"><Input value={f.shortName} onChange={(e) => set("shortName", e.target.value)} /></Field>
        <Field label="Email"><Input value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="Website"><Input value={f.website} onChange={(e) => set("website", e.target.value)} /></Field>
        <Field label="Academic year"><Input value={f.academicYear} onChange={(e) => set("academicYear", e.target.value)} /></Field>
        <Field label="City"><Input value={f.city} onChange={(e) => set("city", e.target.value)} /></Field>
        <Field label="State"><Input value={f.state} onChange={(e) => set("state", e.target.value)} /></Field>
        <Field label="Country"><Input value={f.country} onChange={(e) => set("country", e.target.value)} /></Field>
        <Field label="PIN"><Input value={f.pincode} onChange={(e) => set("pincode", e.target.value)} /></Field>
        <Field label="Currency"><Input value={f.currency} onChange={(e) => set("currency", e.target.value)} /></Field>
        <Field label="Language"><Input value={f.language} onChange={(e) => set("language", e.target.value)} /></Field>
      </div>
      <div className="mt-3"><Field label="Address"><Textarea rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} /></Field></div>
      <div className="mt-3"><Field label="Internal notes"><Textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field></div>
      <div className="mt-3">
        <Button disabled={busy} onClick={() => onSave({
          name: f.name, institutionType: f.institutionType, legalName: blank(f.legalName), shortName: blank(f.shortName),
          email: blank(f.email), phone: blank(f.phone), website: blank(f.website), address: blank(f.address),
          city: blank(f.city), state: blank(f.state), country: blank(f.country), pincode: blank(f.pincode),
          academicYear: blank(f.academicYear), currency: blank(f.currency), language: blank(f.language), notes: blank(f.notes),
        })}>Save profile</Button>
      </div>
    </Card>
  );
}

function SettingsTab({ t, busy, onSave }: { t: Tenant; busy: boolean; onSave: (b: Record<string, unknown>) => void }) {
  const isSchool = t.institutionType === "school";
  const s = (t.settings ?? {}) as Record<string, Record<string, unknown>>;
  const [school, setSchool] = useState<Record<string, unknown>>(s.schoolSettings ?? {});
  const [college, setCollege] = useState<Record<string, unknown>>(s.collegeSettings ?? {});
  const [structure, setStructure] = useState(JSON.stringify(s.academicStructure ?? {}, null, 2));
  const [comm, setComm] = useState<Record<string, unknown>>(s.communication ?? {});
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  const toggle = (obj: Record<string, unknown>, setter: (o: Record<string, unknown>) => void, k: string) => setter({ ...obj, [k]: !obj[k] });
  const commStr = (k: string) => (typeof comm[k] === "string" ? (comm[k] as string) : "");
  const setCommField = (k: string, v: string) => setComm((c) => ({ ...c, [k]: v.trim() === "" ? null : v.trim() }));

  const save = () => {
    let academicStructure: unknown = {};
    try { academicStructure = structure.trim() ? JSON.parse(structure) : {}; setJsonErr(null); }
    catch { setJsonErr("Academic structure must be valid JSON"); return; }
    onSave({ ...(isSchool ? { schoolSettings: school } : { collegeSettings: college }), academicStructure, communication: comm });
  };

  const Check = ({ obj, setter, k, label }: { obj: Record<string, unknown>; setter: (o: Record<string, unknown>) => void; k: string; label: string }) => (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={obj[k] === true} onChange={() => toggle(obj, setter, k)} />
      {label}
    </label>
  );

  return (
    <div className="space-y-4">
      <Card>
        <p className="mb-1 text-sm font-medium text-slate-700">{isSchool ? "School settings" : "College / higher-ed settings"}</p>
        <p className="mb-3 text-xs text-slate-400">Type-based configuration only — the full academic modules live elsewhere in the ERP.</p>
        {isSchool ? (
          <div className="grid grid-cols-2 gap-2">
            <Check obj={school} setter={setSchool} k="classesEnabled" label="Classes" />
            <Check obj={school} setter={setSchool} k="sectionsEnabled" label="Sections" />
            <Check obj={school} setter={setSchool} k="houseSystem" label="House system" />
            <Check obj={school} setter={setSchool} k="classTeacher" label="Class teacher" />
            <Check obj={school} setter={setSchool} k="parentCommunication" label="Parent communication" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Check obj={college} setter={setCollege} k="departmentsEnabled" label="Departments" />
            <Check obj={college} setter={setCollege} k="coursesEnabled" label="Courses / programs" />
            <Check obj={college} setter={setCollege} k="batchesEnabled" label="Batches" />
            <Check obj={college} setter={setCollege} k="creditSystem" label="Credit system" />
            <Check obj={college} setter={setCollege} k="internalMarks" label="Internal marks" />
            <Check obj={college} setter={setCollege} k="universityExam" label="University exam" />
          </div>
        )}
      </Card>
      <Card>
        <Field label="Academic structure (JSON)">
          <Textarea rows={6} value={structure} onChange={(e) => setStructure(e.target.value)} />
        </Field>
        {jsonErr && <p className="mt-1 text-xs text-red-600">{jsonErr}</p>}
      </Card>
      <Card>
        <p className="mb-1 text-sm font-medium text-slate-700">Communication</p>
        <p className="mb-3 text-xs text-slate-400">Default sender identity & notification channels for this tenant. Actual delivery still depends on the platform SMTP/SMS configuration.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email sender name"><Input value={commStr("emailSenderName")} onChange={(e) => setCommField("emailSenderName", e.target.value)} /></Field>
          <Field label="Reply-to email"><Input value={commStr("replyToEmail")} onChange={(e) => setCommField("replyToEmail", e.target.value)} /></Field>
          <Field label="SMS sender ID"><Input value={commStr("smsSenderId")} onChange={(e) => setCommField("smsSenderId", e.target.value)} /></Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-4">
          <Check obj={comm} setter={setComm} k="notifyEmail" label="Email notifications" />
          <Check obj={comm} setter={setComm} k="notifySms" label="SMS notifications" />
        </div>
      </Card>
      <Button disabled={busy} onClick={save}>Save settings</Button>
    </div>
  );
}

function ModulesTab({ t, busy, onSave }: { t: Tenant; busy: boolean; onSave: (m: Record<string, boolean>) => void }) {
  const current = ((t.settings?.enabledModules as Record<string, boolean>) ?? {});
  const [m, setM] = useState<Record<string, boolean>>(current);
  return (
    <Card>
      <p className="mb-3 text-sm font-medium text-slate-700">Enabled modules</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {MODULE_KEYS.map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm capitalize text-slate-600">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={m[k] !== false} onChange={() => setM({ ...m, [k]: m[k] === false })} />
            {k}
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-400">Module access still respects the subscription/package. Unchecked = disabled for this tenant.</p>
      <div className="mt-3"><Button disabled={busy} onClick={() => onSave(m)}>Save modules</Button></div>
    </Card>
  );
}

function BillingTab({ t }: { t: Tenant }) {
  const b = t.billing;
  const sub = b.subscription;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-4">
        <Tile label="Invoices" value={b.total} />
        <Tile label="Issued (unpaid)" value={b.issued} />
        <Tile label="Outstanding" value={`${t.currency ?? "INR"} ${Number(b.outstanding).toFixed(2)}`} />
        <Tile label="Overdue" value={b.overdueCount} />
      </div>
      <Card>
        <p className="mb-2 text-sm font-medium text-slate-700">Subscription</p>
        {sub ? (
          <div className="text-sm text-slate-600">
            {String(sub.packageName)} · <Badge tone="blue">{String(sub.status)}</Badge> · {String(sub.billingCycle)}
            {sub.endsAt ? ` · renews/ends ${String(sub.endsAt)}` : ""}
          </div>
        ) : <p className="text-sm text-slate-400">No subscription assigned. Assign one from the institution console.</p>}
      </Card>
      <Card>
        <p className="mb-2 text-sm font-medium text-slate-700">Latest invoice</p>
        {b.latest ? (
          <div className="text-sm text-slate-600">{String(b.latest.number)} · {String(b.latest.status)} · {t.currency ?? "INR"} {String(b.latest.total)} · {String(b.latest.createdAt)}</div>
        ) : <p className="text-sm text-slate-400">No invoices yet.</p>}
        <div className="mt-3">
          <Link href={`/super-admin/invoices?institutionId=${t.id}`} className="text-sm font-medium text-brand-600 hover:text-brand-700">Open this tenant&apos;s invoices →</Link>
        </div>
      </Card>
    </div>
  );
}

function LimitsTab({ t }: { t: Tenant }) {
  const l = t.limits;
  const row = (label: string, used: number | undefined, max: number | null | string | undefined) => (
    <div className="flex justify-between border-b border-slate-100 py-2 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{used !== undefined ? `${formatNumber(used)} / ` : ""}{limitLabel(max as number | null)}</span>
    </div>
  );
  return (
    <Card>
      <p className="mb-2 text-sm font-medium text-slate-700">Plan limits & usage</p>
      {row("Students", t.usage.students, l.maxStudents)}
      {row("Staff", t.usage.staff, l.maxStaff)}
      {row("Branches", t.usage.branches, l.maxBranches)}
      {row("Storage (MB)", undefined, l.storageLimitMb)}
      {row("Reports quota", undefined, l.reportsQuota)}
      <p className="mt-2 text-xs text-slate-400">Per-tenant overrides win over the package; edit limits from the institution console.</p>
    </Card>
  );
}

function BrandingTab({ t, busy, onSave }: { t: Tenant; busy: boolean; onSave: (slug: string) => void }) {
  const [slug, setSlug] = useState(t.slug ?? "");
  const tenantUrl = slug ? `https://${slug}.gocampusos.com` : "—";
  return (
    <div className="space-y-4">
      <Card>
        <p className="mb-2 text-sm font-medium text-slate-700">Domain / tenant URL</p>
        <Field label="Slug / subdomain"><Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} /></Field>
        <p className="mt-2 text-xs text-slate-400">Tenant URL preview: <span className="font-mono">{tenantUrl}</span></p>
        <p className="mt-1 text-xs text-slate-400">Custom-domain DNS/SSL automation is not configured (future); the slug is stored for tenant routing.</p>
        <div className="mt-3"><Button disabled={busy} onClick={() => onSave(slug)}>Save slug</Button></div>
      </Card>
      <Card>
        <p className="mb-2 text-sm font-medium text-slate-700">Branding</p>
        <p className="text-sm text-slate-600">Logo, theme and display name are managed in the white-label branding module.</p>
        <div className="mt-2"><Link href="/super-admin/settings" className="text-sm font-medium text-brand-600 hover:text-brand-700">Open branding settings →</Link></div>
      </Card>
    </div>
  );
}

function OnboardingTab({ t, busy, onStep, onComplete }: { t: Tenant; busy: boolean; onStep: (s: string, d: boolean) => void; onComplete: () => void }) {
  const p = t.onboardingProgress;
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">Onboarding — {p.completion}% complete</p>
        {p.completedAt && <Badge tone="green">completed</Badge>}
      </div>
      <div className="mb-4 h-2 w-full rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${p.completion}%` }} /></div>
      <ul className="space-y-2">
        {p.steps.map((s) => (
          <li key={s.key} className="flex items-center justify-between text-sm">
            <span className={s.done ? "text-slate-900" : "text-slate-500"}>{s.done ? "✓ " : "○ "}{s.label}</span>
            <button className="text-xs text-brand-600 hover:text-brand-700 disabled:opacity-50" disabled={busy} onClick={() => onStep(s.key, !s.done)}>
              {s.done ? "Mark undone" : "Mark done"}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4"><Button disabled={busy} onClick={onComplete}>Complete onboarding &amp; activate</Button></div>
    </Card>
  );
}

function ComplianceTab({ t, busy, onSave }: { t: Tenant; busy: boolean; onSave: (b: Record<string, unknown>) => void }) {
  const [f, setF] = useState({
    termsAccepted: t.termsAccepted, agreementSigned: t.agreementSigned,
    kycStatus: t.kycStatus, approvalStatus: t.approvalStatus, approvalRemarks: t.approvalRemarks ?? "",
  });
  return (
    <Card>
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={f.termsAccepted} onChange={(e) => setF({ ...f, termsAccepted: e.target.checked })} /> Terms accepted</label>
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={f.agreementSigned} onChange={(e) => setF({ ...f, agreementSigned: e.target.checked })} /> Agreement signed</label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="KYC status"><Select value={f.kycStatus} onChange={(e) => setF({ ...f, kycStatus: e.target.value })}>{["pending", "verified", "rejected"].map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field>
          <Field label="Approval status"><Select value={f.approvalStatus} onChange={(e) => setF({ ...f, approvalStatus: e.target.value })}>{["pending", "approved", "rejected"].map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field>
        </div>
        <Field label="Approval remarks"><Textarea rows={2} value={f.approvalRemarks} onChange={(e) => setF({ ...f, approvalRemarks: e.target.value })} /></Field>
        {t.approvedAt && <p className="text-xs text-slate-400">Last approved/updated: {new Date(t.approvedAt).toLocaleString()}</p>}
      </div>
      <div className="mt-3"><Button disabled={busy} onClick={() => onSave({ ...f, approvalRemarks: f.approvalRemarks.trim() || null })}>Save compliance</Button></div>
    </Card>
  );
}

function AdminsTab({ t, busy, onAdd, onToggle }: { t: Tenant; busy: boolean; onAdd: (b: Record<string, unknown>) => void; onToggle: (uid: string, active: boolean) => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  return (
    <div className="space-y-4">
      <Card>
        <p className="mb-2 text-sm font-medium text-slate-700">Tenant admins</p>
        {t.admins.length === 0 ? <p className="text-sm text-slate-400">No admins yet.</p> : (
          <ul className="divide-y divide-slate-100">
            {t.admins.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                <span><span className="font-medium text-slate-900">{a.fullName}</span> <span className="text-slate-500">{a.email}</span> {!a.isActive && <Badge tone="red">disabled</Badge>}</span>
                <button className="text-xs text-brand-600 hover:text-brand-700 disabled:opacity-50" disabled={busy} onClick={() => onToggle(a.id, !a.isActive)}>{a.isActive ? "Disable" : "Enable"}</button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <p className="mb-2 text-sm font-medium text-slate-700">Add primary admin</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Full name"><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
          <Field label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        </div>
        <p className="mt-2 text-xs text-slate-400">Created with a secure random password; the admin sets theirs via password reset. No default is exposed.</p>
        <div className="mt-3"><Button disabled={busy || !fullName.trim() || !email.trim()} onClick={() => { onAdd({ fullName: fullName.trim(), email: email.trim() }); setFullName(""); setEmail(""); }}>Add admin</Button></div>
      </Card>
    </div>
  );
}

function NotesTab({ id }: { id: string }) {
  interface Note { id: string; noteType: string; body: string; followUpDate: string | null; authorEmail: string | null; createdAt: string }
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteType, setNoteType] = useState("general");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setNotes(await api.get<Note[]>(`/platform/tenants/${id}/notes`).catch(() => [])); }, [id]);
  useEffect(() => { load(); }, [load]);
  const add = async () => { if (!body.trim()) return; setBusy(true); try { setNotes(await api.post<Note[]>(`/platform/tenants/${id}/notes`, { noteType, body: body.trim() })); setBody(""); } finally { setBusy(false); } };
  const del = async (noteId: string) => { setBusy(true); try { setNotes(await api.delete<Note[]>(`/platform/tenants/notes/${noteId}`)); } finally { setBusy(false); } };
  return (
    <div className="space-y-4">
      <Card>
        <p className="mb-2 text-sm font-medium text-slate-700">Internal notes (super-admin only)</p>
        <div className="grid grid-cols-12 gap-2">
          <div className="col-span-3"><Select value={noteType} onChange={(e) => setNoteType(e.target.value)}>{["sales", "support", "billing", "technical", "general"].map((x) => <option key={x} value={x}>{x}</option>)}</Select></div>
          <div className="col-span-7"><Input placeholder="Add a note…" value={body} onChange={(e) => setBody(e.target.value)} /></div>
          <div className="col-span-2"><Button disabled={busy || !body.trim()} onClick={add}>Add</Button></div>
        </div>
      </Card>
      <Card>
        {notes.length === 0 ? <p className="text-sm text-slate-400">No notes yet.</p> : (
          <ul className="divide-y divide-slate-100">
            {notes.map((n) => (
              <li key={n.id} className="flex items-start justify-between gap-2 py-2 text-sm">
                <span><Badge tone="slate">{n.noteType}</Badge> <span className="text-slate-700">{n.body}</span><span className="ml-2 text-xs text-slate-400">{n.authorEmail} · {new Date(n.createdAt).toLocaleDateString()}</span></span>
                <button className="text-xs text-red-600 hover:text-red-700" disabled={busy} onClick={() => del(n.id)}>Delete</button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function AuditTab({ t }: { t: Tenant }) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">Recent activity</p>
        <Link href={`/super-admin/platform/audit?institutionId=${t.id}`} className="text-xs font-medium text-brand-600 hover:text-brand-700">View full audit →</Link>
      </div>
      {t.recentActivity.length === 0 ? <p className="text-sm text-slate-400">No activity yet.</p> : (
        <ul className="space-y-1.5 text-sm">
          {t.recentActivity.map((a, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-1.5 last:border-0">
              <Badge tone="blue">{a.action.replace(/^tenant\./, "")}</Badge>
              <span className="text-slate-400">{new Date(a.createdAt).toLocaleString()}</span>
              {a.actorEmail && <span className="text-slate-600">· {a.actorEmail}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
