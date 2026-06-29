"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from "@/components/ui";
import { usePlatformGuard } from "../../_guard";
import { formatBytes, formatNumber, limitLabel } from "../../_utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

interface Admin { id: string; fullName: string; email: string; isActive: boolean; lastActiveAt: string | null }
interface Branding { displayName: string | null; logoUrl: string | null; primaryColor: string | null; tagline: string | null }
interface OnboardingStep { key: string; label: string; required: boolean; done: boolean }
interface Tenant {
  id: string; name: string; code: string; type: "school" | "college"; institutionType: string;
  isActive: boolean; status: string; slug: string | null;
  legalName: string | null; shortName: string | null; address: string | null; city: string | null;
  state: string | null; country: string | null; pincode: string | null; phone: string | null;
  email: string | null; website: string | null; academicYear: string | null; timezone: string | null;
  currency: string | null; language: string | null; notes: string | null;
  settings: Record<string, unknown>;
  termsAccepted: boolean; agreementSigned: boolean; dataProcessingConsent: boolean;
  kycStatus: string; approvalStatus: string; approvalRemarks: string | null; approvedAt: string | null;
  accountManager: string | null; lastContactedAt: string | null;
  usage: Record<string, number>;
  limits: Record<string, number | null | string>;
  billing: { total: number; issued: number; paid: number; outstanding: string; overdueCount: number; latest: Record<string, unknown> | null; subscription: Record<string, unknown> | null };
  branding: Branding | null;
  documentCount: number;
  admins: Admin[];
  recentActivity: { action: string; actorEmail: string | null; createdAt: string; ip: string | null }[];
  onboardingProgress: { steps: OnboardingStep[]; completion: number; missing: string[]; completedAt: string | null };
}

const TABS = [
  "Overview", "Profile", "Onboarding", "Academic Structure", "Settings", "Modules",
  "Admins", "Subscription & Billing", "Limits & Usage", "Branding & Domain", "Documents",
  "Import", "Communication", "Health", "Compliance", "Notes", "Support", "Audit",
] as const;
type Tab = (typeof TABS)[number];

const MODULE_KEYS = ["admissions", "students", "staff", "attendance", "fees", "exams", "transport", "hostel", "library", "inventory", "communication", "reports", "documents", "certificates", "timetable", "payroll", "hr"];
const statusTone = (s: string) =>
  s === "active" ? "green" : s === "trial" ? "blue" : s === "suspended" || s === "expired" || s === "closed" ? "red" : s === "archived" ? "slate" : "amber";

function authToken() { return useAuthStore.getState().accessToken; }
async function downloadFile(path: string, filename: string) {
  const res = await fetch(`${API_URL}${path}`, { headers: authToken() ? { Authorization: `Bearer ${authToken()}` } : {} });
  if (!res.ok) throw new Error("Download failed");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { ready, gate } = usePlatformGuard("Tenant", "Institution management");
  const [t, setT] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("Overview");
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [actionReason, setActionReason] = useState("");

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
  // Toast-like auto-dismiss for success notices.
  useEffect(() => { if (!notice) return; const x = setTimeout(() => setNotice(null), 4500); return () => clearTimeout(x); }, [notice]);

  const reasonRequired = (s: string) => s === "suspended" || s === "archived" || s === "closed";
  const lifecycle = (status: string) => {
    if (reasonRequired(status)) { setActionReason(""); setPendingStatus(status); return; }
    act(() => api.post(`/platform/tenants/${id}/lifecycle`, { status }), `Tenant ${status}.`);
  };
  const confirmLifecycle = () => {
    const status = pendingStatus;
    if (!status) return;
    setPendingStatus(null);
    act(() => api.post(`/platform/tenants/${id}/lifecycle`, { status, reason: actionReason }), `Tenant ${status}.`);
  };

  const completeOnboarding = () => {
    const miss = t?.onboardingProgress.missing ?? [];
    if (miss.length && !window.confirm(`Required steps incomplete: ${miss.join(", ")}.\n\nActivate anyway (super-admin override)?`)) return;
    act(() => api.post(`/platform/tenants/${id}/onboarding/complete`, { override: miss.length > 0 }), "Onboarding completed.");
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
        subtitle={`${t.code} · ${t.institutionType} · structural ${t.type}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(t.status)}>{t.status}</Badge>
            {t.status === "draft" && <Button variant="secondary" onClick={completeOnboarding} disabled={busy}>Activate</Button>}
            {t.status !== "active" && t.status !== "draft" && t.status !== "archived" && t.status !== "closed" && (
              <Button variant="secondary" onClick={() => lifecycle("active")} disabled={busy}>Reactivate</Button>
            )}
            {t.status === "active" && <Button variant="secondary" onClick={() => lifecycle("trial")} disabled={busy}>Mark trial</Button>}
            {t.status === "active" && <Button variant="secondary" onClick={() => lifecycle("suspended")} disabled={busy}>Suspend</Button>}
            {(t.status === "active" || t.status === "trial") && <Button variant="secondary" onClick={() => lifecycle("expired")} disabled={busy}>Mark expired</Button>}
            {t.status !== "archived" && t.status !== "closed" && <Button variant="secondary" onClick={() => lifecycle("archived")} disabled={busy}>Archive</Button>}
            {t.status !== "closed" && <Button variant="danger" onClick={() => lifecycle("closed")} disabled={busy}>Close</Button>}
          </div>
        }
      />
      {error && <ErrorNote message={error} />}
      {notice && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>}

      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((x) => (
          <button key={x} onClick={() => setTab(x)}
            className={`px-3 py-2 text-sm font-medium ${tab === x ? "border-b-2 border-brand-600 text-brand-700" : "text-slate-500 hover:text-slate-700"}`}>
            {x}
          </button>
        ))}
      </div>

      {tab === "Overview" && <OverviewTab t={t} />}
      {tab === "Profile" && <ProfileTab t={t} busy={busy} onSave={(b) => act(() => api.patch(`/platform/tenants/${id}`, b), "Profile saved.")} />}
      {tab === "Onboarding" && <OnboardingTab t={t} busy={busy}
        onStep={(step, done) => act(() => api.post(`/platform/tenants/${id}/onboarding/step`, { step, done }))}
        onComplete={completeOnboarding} />}
      {tab === "Academic Structure" && <AcademicStructureTab t={t} busy={busy} onSave={(academicStructure) => act(() => api.patch(`/platform/tenants/${id}/settings`, { academicStructure }), "Academic structure saved.")} />}
      {tab === "Settings" && <SettingsTab t={t} busy={busy} onSave={(b) => act(() => api.patch(`/platform/tenants/${id}/settings`, b), "Settings saved.")} />}
      {tab === "Modules" && <ModulesTab t={t} busy={busy} onSave={(enabledModules) => act(() => api.patch(`/platform/tenants/${id}/settings`, { enabledModules }), "Modules saved.")} />}
      {tab === "Admins" && <AdminsTab t={t} busy={busy} id={id}
        onAdd={(b) => act(() => api.post(`/platform/tenants/${id}/admin`, b), "Admin added — a setup link was emailed if SMTP is configured.")}
        onToggle={(uid, active) => act(() => api.patch(`/platform/tenants/${id}/admin/${uid}`, { active }))}
        onResetLink={(uid) => act(async () => { const r = await api.post<{ emailSent: boolean }>(`/platform/tenants/${id}/admin/${uid}/reset-link`, {}); setNotice(r.emailSent ? "Setup/reset link emailed." : "Email is not configured — link not delivered."); })} />}
      {tab === "Subscription & Billing" && <SubscriptionTab t={t} busy={busy} onChanged={load} setNotice={setNotice} setError={setError} />}
      {tab === "Limits & Usage" && <LimitsTab t={t} busy={busy} onSave={(limits) => act(() => api.patch(`/platform/institutions/${id}/limits`, limits), "Limits saved.")} />}
      {tab === "Branding & Domain" && <BrandingTab t={t} busy={busy}
        onSaveSlug={(slug) => act(() => api.patch(`/platform/tenants/${id}`, { slug }), "Slug saved.")}
        onSaveBranding={(b) => act(() => api.patch(`/platform/tenants/${id}/branding`, b), "Branding saved.")} />}
      {tab === "Documents" && <DocumentsTab id={id} />}
      {tab === "Import" && <ImportTab t={t} />}
      {tab === "Communication" && <CommunicationTab t={t} busy={busy} onSave={(communication) => act(() => api.patch(`/platform/tenants/${id}/settings`, { communication }), "Communication saved.")} />}
      {tab === "Health" && <HealthTab id={id} t={t} />}
      {tab === "Compliance" && <ComplianceTab t={t} busy={busy} onSave={(b) => act(() => api.patch(`/platform/tenants/${id}/compliance`, b), "Compliance saved.")} />}
      {tab === "Notes" && <NotesTab id={id} t={t} busy={busy} onSaveCrm={(b) => act(() => api.patch(`/platform/tenants/${id}/crm`, b), "CRM saved.")} />}
      {tab === "Support" && <SupportTab id={id} setNotice={setNotice} setError={setError} />}
      {tab === "Audit" && <AuditTab t={t} />}

      <Modal title={`Confirm: ${pendingStatus ?? ""}`} open={pendingStatus !== null} onClose={() => setPendingStatus(null)}>
        <div className="space-y-4">
          {(pendingStatus === "archived" || pendingStatus === "closed") && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <p className="mb-1 font-medium">Closure checklist (recommended before {pendingStatus}):</p>
              <ul className="list-inside list-disc space-y-0.5 text-xs">
                <li>Export the tenant profile &amp; users (Overview → Export &amp; safe exit)</li>
                <li>Confirm outstanding invoices are settled or written off</li>
                <li>Notify the tenant admin</li>
                <li>Download any required documents</li>
              </ul>
              <p className="mt-2 text-xs">Data is preserved — {pendingStatus === "closed" ? "closing" : "archiving"} never deletes invoices, users, records, documents or audit history.</p>
            </div>
          )}
          <Field label="Reason (required — recorded in the audit log)">
            <Textarea rows={3} value={actionReason} onChange={(e) => setActionReason(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPendingStatus(null)}>Cancel</Button>
            <Button variant="danger" disabled={busy || actionReason.trim().length === 0} onClick={confirmLifecycle}>
              Confirm {pendingStatus}
            </Button>
          </div>
        </div>
      </Modal>
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
        <Tile label="Status" value={t.status} />
        <Tile label="Students" value={formatNumber(t.usage.students)} />
        <Tile label="Staff" value={formatNumber(t.usage.staff)} />
        <Tile label="Users" value={formatNumber(t.usage.users)} />
        <Tile label="Active sessions" value={formatNumber(t.usage.activeSessions)} />
        <Tile label="Outstanding" value={`${t.currency ?? "INR"} ${Number(t.billing.outstanding).toFixed(2)}`} hint={`${t.billing.overdueCount} overdue`} />
        <Tile label="Onboarding" value={`${t.onboardingProgress.completion}%`} hint={t.onboardingProgress.missing.length ? `${t.onboardingProgress.missing.length} required left` : "required steps done"} />
      </div>
      <Card>
        <p className="mb-2 text-sm font-medium text-slate-700">Contact</p>
        <div className="grid grid-cols-2 gap-2 text-sm text-slate-600">
          <div>Email: {t.email ?? "—"}</div><div>Phone: {t.phone ?? "—"}</div>
          <div>Website: {t.website ?? "—"}</div><div>Slug: {t.slug ?? "—"}</div>
          <div>Documents: {formatNumber(t.documentCount)}</div><div>Package: {(t.billing.subscription?.packageName as string) ?? "—"}</div>
          <div className="col-span-2">Address: {[t.address, t.city, t.state, t.country, t.pincode].filter(Boolean).join(", ") || "—"}</div>
        </div>
      </Card>
      <Card>
        <p className="mb-1 text-sm font-medium text-slate-700">Export & safe exit</p>
        <p className="mb-3 text-xs text-slate-400">Export basic records before archiving/closing a tenant. Closing/archiving never deletes data — invoices, users, academic records, documents and audit history are preserved.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => downloadFile(`/platform/tenants/${t.id}/export?format=csv`, `${t.code}-profile.csv`)}>Export profile (CSV)</Button>
          <Button variant="secondary" onClick={() => downloadFile(`/platform/tenants/${t.id}/export?format=xlsx`, `${t.code}-profile.xlsx`)}>Profile (XLSX)</Button>
          <Button variant="secondary" onClick={() => downloadFile(`/platform/tenants/${t.id}/users/export?format=csv`, `${t.code}-users.csv`)}>Export users (CSV)</Button>
          <Button variant="secondary" onClick={() => downloadFile(`/platform/tenants/${t.id}/users/export?format=xlsx`, `${t.code}-users.xlsx`)}>Users (XLSX)</Button>
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
    academicYear: t.academicYear ?? "", timezone: t.timezone ?? "", currency: t.currency ?? "", language: t.language ?? "", notes: t.notes ?? "",
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
        <Field label="Legal / registered name"><Input value={f.legalName} onChange={(e) => set("legalName", e.target.value)} /></Field>
        <Field label="Short / display name"><Input value={f.shortName} onChange={(e) => set("shortName", e.target.value)} /></Field>
        <Field label="Email"><Input value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="Website"><Input value={f.website} onChange={(e) => set("website", e.target.value)} /></Field>
        <Field label="Academic year / session"><Input value={f.academicYear} onChange={(e) => set("academicYear", e.target.value)} /></Field>
        <Field label="City"><Input value={f.city} onChange={(e) => set("city", e.target.value)} /></Field>
        <Field label="State"><Input value={f.state} onChange={(e) => set("state", e.target.value)} /></Field>
        <Field label="Country"><Input value={f.country} onChange={(e) => set("country", e.target.value)} /></Field>
        <Field label="PIN / postal code"><Input value={f.pincode} onChange={(e) => set("pincode", e.target.value)} /></Field>
        <Field label="Time zone"><Input value={f.timezone} onChange={(e) => set("timezone", e.target.value)} /></Field>
        <Field label="Currency"><Input value={f.currency} onChange={(e) => set("currency", e.target.value)} /></Field>
        <Field label="Language"><Input value={f.language} onChange={(e) => set("language", e.target.value)} /></Field>
      </div>
      <div className="mt-3"><Field label="Address"><Textarea rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} /></Field></div>
      <div className="mt-3"><Field label="Internal remarks"><Textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field></div>
      <div className="mt-3">
        <Button disabled={busy} onClick={() => onSave({
          name: f.name, institutionType: f.institutionType, legalName: blank(f.legalName), shortName: blank(f.shortName),
          email: blank(f.email), phone: blank(f.phone), website: blank(f.website), address: blank(f.address),
          city: blank(f.city), state: blank(f.state), country: blank(f.country), pincode: blank(f.pincode),
          academicYear: blank(f.academicYear), timezone: blank(f.timezone), currency: blank(f.currency), language: blank(f.language), notes: blank(f.notes),
        })}>Save profile</Button>
      </div>
    </Card>
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
      {p.missing.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Required before activation: {p.missing.join(", ")}
        </div>
      )}
      <ul className="space-y-2">
        {p.steps.map((s) => (
          <li key={s.key} className="flex items-center justify-between text-sm">
            <span className={s.done ? "text-slate-900" : "text-slate-500"}>
              {s.done ? "✓ " : "○ "}{s.label}{s.required && <span className="ml-1 text-xs text-amber-600">(required)</span>}
            </span>
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

function AcademicStructureTab({ t, busy, onSave }: { t: Tenant; busy: boolean; onSave: (s: unknown) => void }) {
  const s = (t.settings ?? {}) as Record<string, unknown>;
  const [structure, setStructure] = useState(JSON.stringify(s.academicStructure ?? {}, null, 2));
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  // Type-aware presets so a super-admin can start from the right shape.
  const presets: Record<string, Record<string, unknown>> = {
    school: { levels: ["class", "section"], terms: ["term1", "term2"], rollNumberFormat: "", admissionNumberFormat: "" },
    college: { levels: ["department", "program", "semester", "section"], subjectMode: "subject", enrollmentNumberFormat: "" },
    university: { levels: ["faculty", "department", "program", "semester"], subjectMode: "course" },
    coaching: { levels: ["course", "batch", "session"] },
    other: { levels: [] },
  };
  const applyPreset = () => setStructure(JSON.stringify(presets[t.institutionType] ?? presets.other, null, 2));
  const save = () => {
    try { const parsed = structure.trim() ? JSON.parse(structure) : {}; setJsonErr(null); onSave(parsed); }
    catch { setJsonErr("Academic structure must be valid JSON"); }
  };
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">Academic structure ({t.institutionType})</p>
        <Button variant="secondary" onClick={applyPreset}>Insert {t.institutionType} preset</Button>
      </div>
      <p className="mb-3 text-xs text-slate-400">Configure the tenant&apos;s structural shape only — the full academic modules live elsewhere in the ERP. School: class/section/term · College: department/program/semester · University: faculty/department/program · Coaching: course/batch/session.</p>
      <Field label="Structure (JSON)"><Textarea rows={10} value={structure} onChange={(e) => setStructure(e.target.value)} /></Field>
      {jsonErr && <p className="mt-1 text-xs text-red-600">{jsonErr}</p>}
      <div className="mt-3"><Button disabled={busy} onClick={save}>Save academic structure</Button></div>
    </Card>
  );
}

function Check({ obj, set, k, label }: { obj: Record<string, unknown>; set: (o: Record<string, unknown>) => void; k: string; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={obj[k] === true} onChange={() => set({ ...obj, [k]: !obj[k] })} />
      {label}
    </label>
  );
}

function SettingsTab({ t, busy, onSave }: { t: Tenant; busy: boolean; onSave: (b: Record<string, unknown>) => void }) {
  const isSchool = t.institutionType === "school";
  const s = (t.settings ?? {}) as Record<string, Record<string, unknown>>;
  const [school, setSchool] = useState<Record<string, unknown>>(s.schoolSettings ?? {});
  const [college, setCollege] = useState<Record<string, unknown>>(s.collegeSettings ?? {});
  const str = (o: Record<string, unknown>, k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  const setStr = (o: Record<string, unknown>, set: (x: Record<string, unknown>) => void, k: string, v: string) => set({ ...o, [k]: v });

  return (
    <div className="space-y-4">
      {isSchool ? (
        <Card>
          <p className="mb-3 text-sm font-medium text-slate-700">School settings</p>
          <div className="grid grid-cols-2 gap-2">
            <Check obj={school} set={setSchool} k="classesEnabled" label="Classes enabled" />
            <Check obj={school} set={setSchool} k="sectionsEnabled" label="Sections enabled" />
            <Check obj={school} set={setSchool} k="houseSystem" label="House system" />
            <Check obj={school} set={setSchool} k="classTeacher" label="Class teacher concept" />
            <Check obj={school} set={setSchool} k="parentCommunication" label="Parent/guardian communication" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Roll number format"><Input value={str(school, "rollNumberFormat")} onChange={(e) => setStr(school, setSchool, "rollNumberFormat", e.target.value)} /></Field>
            <Field label="Admission number format"><Input value={str(school, "admissionNumberFormat")} onChange={(e) => setStr(school, setSchool, "admissionNumberFormat", e.target.value)} /></Field>
            <Field label="Exam pattern"><Select value={str(school, "examPattern")} onChange={(e) => setStr(school, setSchool, "examPattern", e.target.value)}><option value="">—</option>{["term", "quarterly", "half_yearly", "annual"].map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field>
            <Field label="Attendance mode"><Select value={str(school, "attendanceMode")} onChange={(e) => setStr(school, setSchool, "attendanceMode", e.target.value)}><option value="">—</option>{["daily", "period"].map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field>
            <Field label="Fee structure mode"><Select value={str(school, "feeStructureMode")} onChange={(e) => setStr(school, setSchool, "feeStructureMode", e.target.value)}><option value="">—</option>{["class", "section"].map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field>
          </div>
        </Card>
      ) : (
        <Card>
          <p className="mb-3 text-sm font-medium text-slate-700">College / higher-ed settings</p>
          <div className="grid grid-cols-2 gap-2">
            <Check obj={college} set={setCollege} k="departmentsEnabled" label="Departments" />
            <Check obj={college} set={setCollege} k="coursesEnabled" label="Courses / programs" />
            <Check obj={college} set={setCollege} k="batchesEnabled" label="Batches" />
            <Check obj={college} set={setCollege} k="sectionGroupEnabled" label="Section / group" />
            <Check obj={college} set={setCollege} k="creditSystem" label="Credit system" />
            <Check obj={college} set={setCollege} k="internalMarks" label="Internal marks" />
            <Check obj={college} set={setCollege} k="universityExam" label="University exam" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Semester / year system"><Select value={str(college, "semesterSystem")} onChange={(e) => setStr(college, setCollege, "semesterSystem", e.target.value)}><option value="">—</option>{["semester", "year"].map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field>
            <Field label="Subject / paper mapping"><Select value={str(college, "subjectMappingMode")} onChange={(e) => setStr(college, setCollege, "subjectMappingMode", e.target.value)}><option value="">—</option>{["subject", "paper"].map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field>
            <Field label="Attendance mode"><Select value={str(college, "attendanceMode")} onChange={(e) => setStr(college, setCollege, "attendanceMode", e.target.value)}><option value="">—</option>{["subject", "daily"].map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field>
            <Field label="Fee structure mode"><Select value={str(college, "feeStructureMode")} onChange={(e) => setStr(college, setCollege, "feeStructureMode", e.target.value)}><option value="">—</option>{["course", "semester"].map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field>
            <Field label="Enrollment number format"><Input value={str(college, "enrollmentNumberFormat")} onChange={(e) => setStr(college, setCollege, "enrollmentNumberFormat", e.target.value)} /></Field>
          </div>
        </Card>
      )}
      <Button disabled={busy} onClick={() => onSave(isSchool ? { schoolSettings: school } : { collegeSettings: college })}>Save settings</Button>
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

function AdminsTab({ t, busy, onAdd, onToggle, onResetLink }: { t: Tenant; busy: boolean; id: string; onAdd: (b: Record<string, unknown>) => void; onToggle: (uid: string, active: boolean) => void; onResetLink: (uid: string) => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  return (
    <div className="space-y-4">
      <Card>
        <p className="mb-2 text-sm font-medium text-slate-700">Tenant admins</p>
        {t.admins.length === 0 ? <p className="text-sm text-slate-400">No admins yet.</p> : (
          <ul className="divide-y divide-slate-100">
            {t.admins.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <span className="font-medium text-slate-900">{a.fullName}</span> <span className="text-slate-500">{a.email}</span>{" "}
                  {a.isActive ? <Badge tone="green">active</Badge> : <Badge tone="red">disabled</Badge>}
                  <span className="ml-2 text-xs text-slate-400">last active: {a.lastActiveAt ? new Date(a.lastActiveAt).toLocaleString() : "never"}</span>
                </span>
                <span className="flex gap-3">
                  <button className="text-xs text-brand-600 hover:text-brand-700 disabled:opacity-50" disabled={busy} onClick={() => onResetLink(a.id)}>Send setup/reset link</button>
                  <button className="text-xs text-brand-600 hover:text-brand-700 disabled:opacity-50" disabled={busy} onClick={() => onToggle(a.id, !a.isActive)}>{a.isActive ? "Disable" : "Enable"}</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <p className="mb-2 text-sm font-medium text-slate-700">Add / change primary admin</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Full name"><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
          <Field label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        </div>
        <p className="mt-2 text-xs text-slate-400">Created with a secure random password and emailed a setup link (if SMTP is configured). To change the primary admin, add the new one and disable the old. No password is ever exposed.</p>
        <div className="mt-3"><Button disabled={busy || !fullName.trim() || !email.trim()} onClick={() => { onAdd({ fullName: fullName.trim(), email: email.trim() }); setFullName(""); setEmail(""); }}>Add admin</Button></div>
      </Card>
    </div>
  );
}

function SubscriptionTab({ t, busy, onChanged, setNotice, setError }: { t: Tenant; busy: boolean; onChanged: () => void; setNotice: (s: string | null) => void; setError: (s: string | null) => void }) {
  const b = t.billing;
  const [packages, setPackages] = useState<{ id: string; name: string; billingCycle: string }[]>([]);
  const [events, setEvents] = useState<{ event: string; fromStatus: string | null; toStatus: string | null; createdAt: string }[]>([]);
  const [packageId, setPackageId] = useState("");
  const [subStatus, setSubStatus] = useState("active");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.get<{ id: string; name: string; billingCycle: string }[]>("/packages").then(setPackages).catch(() => setPackages([]));
    api.get<{ event: string; fromStatus: string | null; toStatus: string | null; createdAt: string }[]>(`/platform/institutions/${t.id}/subscription/events`).then(setEvents).catch(() => setEvents([]));
  }, [t.id]);
  const assign = async () => {
    if (!packageId) { setError("Choose a package"); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      await api.post(`/platform/institutions/${t.id}/subscription`, { packageId, status: subStatus });
      setNotice("Subscription assigned."); onChanged();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Failed to assign subscription"); }
    finally { setSaving(false); }
  };
  const createInvoice = async () => {
    setSaving(true); setError(null); setNotice(null);
    try {
      await api.post(`/platform/institutions/${t.id}/invoices`, {}); // blank draft; lines/issue done in the invoice flow
      setNotice("Draft invoice created — open invoices to add lines & issue."); onChanged();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Failed to create invoice"); }
    finally { setSaving(false); }
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-4">
        <Tile label="Invoices" value={b.total} />
        <Tile label="Issued (unpaid)" value={b.issued} />
        <Tile label="Outstanding" value={`${t.currency ?? "INR"} ${Number(b.outstanding).toFixed(2)}`} />
        <Tile label="Overdue" value={b.overdueCount} />
      </div>
      <Card>
        <p className="mb-2 text-sm font-medium text-slate-700">Current subscription</p>
        {b.subscription ? (
          <div className="text-sm text-slate-600">
            {String(b.subscription.packageName)} · <Badge tone="blue">{String(b.subscription.status)}</Badge> · {String(b.subscription.billingCycle)}
            {b.subscription.endsAt ? ` · renews/ends ${String(b.subscription.endsAt)}` : ""}
          </div>
        ) : <p className="text-sm text-slate-400">No subscription assigned.</p>}
      </Card>
      <Card>
        <p className="mb-2 text-sm font-medium text-slate-700">Assign / change package</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Package"><Select value={packageId} onChange={(e) => setPackageId(e.target.value)}><option value="">Choose…</option>{packages.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.billingCycle})</option>)}</Select></Field>
          <Field label="Status"><Select value={subStatus} onChange={(e) => setSubStatus(e.target.value)}>{["active", "trialing", "suspended", "cancelled"].map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field>
          <div className="flex items-end"><Button disabled={saving || busy} onClick={assign}>Assign</Button></div>
        </div>
      </Card>
      <Card>
        <p className="mb-2 text-sm font-medium text-slate-700">Latest invoice</p>
        {b.latest ? (
          <div className="text-sm text-slate-600">{String(b.latest.number)} · {String(b.latest.status)} · {t.currency ?? "INR"} {String(b.latest.total)} · {String(b.latest.createdAt)}</div>
        ) : <p className="text-sm text-slate-400">No invoices yet.</p>}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button disabled={saving || busy} onClick={createInvoice}>+ Create draft invoice</Button>
          <Link href={`/super-admin/invoices?institutionId=${t.id}`} className="text-sm font-medium text-brand-600 hover:text-brand-700">Open this tenant&apos;s invoices →</Link>
        </div>
      </Card>
      <Card>
        <p className="mb-2 text-sm font-medium text-slate-700">Subscription history</p>
        {events.length === 0 ? <p className="text-sm text-slate-400">No subscription events yet.</p> : (
          <ul className="space-y-1.5 text-sm">
            {events.slice(0, 20).map((e, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-1.5 last:border-0">
                <Badge tone="slate">{e.event}</Badge>
                {e.fromStatus && <span className="text-slate-500">{e.fromStatus} → {e.toStatus}</span>}
                <span className="text-slate-400">{new Date(e.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function LimitsTab({ t, busy, onSave }: { t: Tenant; busy: boolean; onSave: (l: Record<string, number | null>) => void }) {
  const l = t.limits;
  const num = (v: number | null | string | undefined) => (v == null || v === "" ? "" : String(v));
  const [f, setF] = useState({
    maxStudents: num(l.maxStudents), maxStaff: num(l.maxStaff), maxBranches: num(l.maxBranches),
    storageLimitMb: num(l.storageLimitMb), reportsQuota: num(l.reportsQuota),
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const over = (used: number | undefined, max: number | null | string | undefined) =>
    used != null && max != null && typeof max === "number" && used > max;
  const near = (used: number | undefined, max: number | null | string | undefined) =>
    used != null && max != null && typeof max === "number" && max > 0 && used >= max * 0.9 && used <= max;
  const row = (label: string, key: string, used?: number) => {
    const max = l[key];
    return (
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 text-sm last:border-0">
        <span className="text-slate-500">{label}{over(used, max) && <Badge tone="red">over limit</Badge>}{!over(used, max) && near(used, max) && <Badge tone="amber">near limit</Badge>}</span>
        <span className="flex items-center gap-2">
          {used !== undefined && <span className="text-slate-400">{formatNumber(used)} /</span>}
          <Input className="w-28" placeholder="∞" value={(f as Record<string, string>)[key] ?? ""} onChange={(e) => set(key, e.target.value)} />
        </span>
      </div>
    );
  };
  const save = () => {
    const toNum = (v: string) => (v.trim() === "" ? null : Number(v));
    onSave({ maxStudents: toNum(f.maxStudents), maxStaff: toNum(f.maxStaff), maxBranches: toNum(f.maxBranches), storageLimitMb: toNum(f.storageLimitMb), reportsQuota: toNum(f.reportsQuota) });
  };
  return (
    <Card>
      <p className="mb-2 text-sm font-medium text-slate-700">Plan limits & usage</p>
      <p className="mb-3 text-xs text-slate-400">Per-tenant overrides win over the package. Leave blank for unlimited (∞). Current effective: students {limitLabel(l.maxStudents as number | null)}, staff {limitLabel(l.maxStaff as number | null)}.</p>
      {row("Students", "maxStudents", t.usage.students)}
      {row("Staff", "maxStaff", t.usage.staff)}
      {row("Branches", "maxBranches", t.usage.branches)}
      {row("Storage (MB)", "storageLimitMb")}
      {row("Reports quota", "reportsQuota")}
      {Number(t.billing.overdueCount) > 0 && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">Billing overdue: {t.billing.overdueCount} invoice(s) past due.</div>}
      <div className="mt-3"><Button disabled={busy} onClick={save}>Save limits</Button></div>
    </Card>
  );
}

function BrandingTab({ t, busy, onSaveSlug, onSaveBranding }: { t: Tenant; busy: boolean; onSaveSlug: (slug: string) => void; onSaveBranding: (b: Record<string, unknown>) => void }) {
  const [slug, setSlug] = useState(t.slug ?? "");
  const br = t.branding ?? { displayName: "", logoUrl: "", primaryColor: "", tagline: "" };
  const [f, setF] = useState({ displayName: br.displayName ?? "", logoUrl: br.logoUrl ?? "", primaryColor: br.primaryColor ?? "", tagline: br.tagline ?? "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const blank = (v: string) => (v.trim() === "" ? null : v.trim());
  const tenantUrl = slug ? `https://${slug}.gocampusos.com` : "—";
  return (
    <div className="space-y-4">
      <Card>
        <p className="mb-2 text-sm font-medium text-slate-700">Domain / tenant URL</p>
        <Field label="Slug / subdomain"><Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} /></Field>
        <p className="mt-2 text-xs text-slate-400">Tenant URL preview: <span className="font-mono">{tenantUrl}</span> · uniqueness is enforced server-side. Custom-domain DNS/SSL automation is not configured (slug is stored for routing only).</p>
        <div className="mt-3 flex gap-2">
          <Button disabled={busy} onClick={() => onSaveSlug(slug)}>Save slug</Button>
          {slug && <a href={tenantUrl} target="_blank" rel="noreferrer"><Button variant="secondary">Open tenant ↗</Button></a>}
        </div>
      </Card>
      <Card>
        <p className="mb-2 text-sm font-medium text-slate-700">Branding</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Public display name"><Input value={f.displayName} onChange={(e) => set("displayName", e.target.value)} /></Field>
          <Field label="Tagline"><Input value={f.tagline} onChange={(e) => set("tagline", e.target.value)} /></Field>
          <Field label="Logo URL"><Input value={f.logoUrl} onChange={(e) => set("logoUrl", e.target.value)} /></Field>
          <Field label="Primary / accent colour (#rrggbb)"><Input value={f.primaryColor} onChange={(e) => set("primaryColor", e.target.value)} /></Field>
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
          {f.primaryColor && /^#[0-9a-fA-F]{6}$/.test(f.primaryColor) && <span className="inline-block h-4 w-4 rounded" style={{ backgroundColor: f.primaryColor }} />}
          Logo file upload runs in the tenant app (white-label module); here you can set the logo URL + identity.
        </div>
        <div className="mt-3"><Button disabled={busy} onClick={() => onSaveBranding({ displayName: blank(f.displayName), tagline: blank(f.tagline), logoUrl: blank(f.logoUrl), primaryColor: blank(f.primaryColor) })}>Save branding</Button></div>
      </Card>
    </div>
  );
}

const DOC_CATEGORIES = ["registration", "trust_company", "gst", "pan_tan", "agreement", "authorization", "logo", "other"];
interface Doc { id: string; category: string; originalName: string; mimeType: string; sizeBytes: number; verificationStatus: string; verificationRemarks: string | null; archivedAt: string | null; uploadedByEmail: string | null; createdAt: string }

function DocumentsTab({ id }: { id: string }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [category, setCategory] = useState("registration");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { try { setDocs(await api.get<Doc[]>(`/platform/tenants/${id}/documents`)); } catch { setDocs([]); } }, [id]);
  useEffect(() => { load(); }, [load]);
  const upload = async () => {
    if (!file) { setErr("Choose a file (PDF or image)"); return; }
    setBusy(true); setErr(null);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("category", category);
      const res = await fetch(`${API_URL}/platform/tenants/${id}/documents`, { method: "POST", headers: authToken() ? { Authorization: `Bearer ${authToken()}` } : {}, body: fd });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error?.message || j.message || "Upload failed"); }
      setDocs(await res.json()); setFile(null);
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); }
    finally { setBusy(false); }
  };
  const verify = async (docId: string, status: string) => {
    const remarks = status === "rejected" ? window.prompt("Rejection remarks (optional):") ?? undefined : undefined;
    setBusy(true); try { setDocs(await api.patch<Doc[]>(`/platform/tenants/${id}/documents/${docId}/verify`, { status, remarks })); } finally { setBusy(false); }
  };
  const archive = async (docId: string) => { setBusy(true); try { setDocs(await api.post<Doc[]>(`/platform/tenants/${id}/documents/${docId}/archive`, {})); } finally { setBusy(false); } };
  const del = async (docId: string) => { if (!window.confirm("Delete this document file permanently?")) return; setBusy(true); try { setDocs(await api.delete<Doc[]>(`/platform/tenants/${id}/documents/${docId}`)); } finally { setBusy(false); } };
  const tone = (s: string) => (s === "verified" ? "green" : s === "rejected" ? "red" : "amber");
  return (
    <div className="space-y-4">
      <Card>
        <p className="mb-2 text-sm font-medium text-slate-700">Upload document</p>
        {err && <ErrorNote message={err} />}
        <div className="grid grid-cols-12 items-end gap-2">
          <div className="col-span-3"><Field label="Type"><Select value={category} onChange={(e) => setCategory(e.target.value)}>{DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace("_", "/")}</option>)}</Select></Field></div>
          <div className="col-span-7"><Field label="File (PDF or image)"><input type="file" className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-white" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field></div>
          <div className="col-span-2"><Button disabled={busy || !file} onClick={upload}>Upload</Button></div>
        </div>
      </Card>
      <Card>
        {docs.length === 0 ? <p className="text-sm text-slate-400">No documents uploaded.</p> : (
          <ul className="divide-y divide-slate-100">
            {docs.map((d) => (
              <li key={d.id} className={`flex flex-wrap items-center justify-between gap-2 py-2 text-sm ${d.archivedAt ? "opacity-50" : ""}`}>
                <span>
                  <Badge tone="slate">{d.category.replace("_", "/")}</Badge>{" "}
                  <span className="text-slate-800">{d.originalName}</span>{" "}
                  <span className="text-xs text-slate-400">{formatBytes(d.sizeBytes)} · {d.uploadedByEmail} · {new Date(d.createdAt).toLocaleDateString()}</span>{" "}
                  <Badge tone={tone(d.verificationStatus)}>{d.verificationStatus}</Badge>
                  {d.archivedAt && <Badge tone="slate">archived</Badge>}
                </span>
                <span className="flex flex-wrap gap-3 text-xs">
                  <button className="text-brand-600 hover:text-brand-700" onClick={() => downloadFile(`/platform/tenants/${id}/documents/${d.id}/download`, d.originalName)}>Download</button>
                  {!d.archivedAt && <button className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50" disabled={busy} onClick={() => verify(d.id, "verified")}>Verify</button>}
                  {!d.archivedAt && <button className="text-amber-600 hover:text-amber-700 disabled:opacity-50" disabled={busy} onClick={() => verify(d.id, "rejected")}>Reject</button>}
                  {!d.archivedAt && <button className="text-slate-600 hover:text-slate-700 disabled:opacity-50" disabled={busy} onClick={() => archive(d.id)}>Archive</button>}
                  <button className="text-red-600 hover:text-red-700 disabled:opacity-50" disabled={busy} onClick={() => del(d.id)}>Delete</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ImportTab({ t }: { t: Tenant }) {
  const csvTemplate = (headers: string[], name: string) => {
    const blob = new Blob(["﻿" + headers.join(",") + "\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return (
    <div className="space-y-4">
      <Card>
        <p className="mb-1 text-sm font-medium text-slate-700">Import &amp; setup shortcuts</p>
        <p className="mb-3 text-xs text-slate-400">
          Bulk import runs inside the <b>tenant workspace</b> (rows must map to the tenant&apos;s own
          classes/courses), so it isn&apos;t performed cross-tenant from here. Use the
          <b> Support</b> tab to open a session as a tenant admin and run Students → Import / Staff → Import,
          or send these starter templates to the tenant admin.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => csvTemplate(["fullName", "gender", "dateOfBirth", "guardianName", "guardianPhone", "className", "sectionName"], "students-import-template.csv")}>Download students template</Button>
          <Button variant="secondary" onClick={() => csvTemplate(["fullName", "email", "phone", "designation", "department"], "staff-import-template.csv")}>Download staff template</Button>
        </div>
        <p className="mt-2 text-xs text-slate-400">Templates are a starting point — match the columns shown on the tenant&apos;s own import screen.</p>
      </Card>
      <Card>
        <p className="mb-2 text-sm font-medium text-slate-700">Availability</p>
        <ul className="space-y-1 text-sm text-slate-600">
          <li>✓ Students bulk import (tenant workspace)</li>
          <li>✓ Staff / teachers bulk import (tenant workspace)</li>
          <li className="text-slate-400">— Classes / courses &amp; fee-structure import: not available yet (no bulk endpoint)</li>
          <li className="text-slate-400">— Import history / error report: not tracked</li>
        </ul>
        {t.slug && <p className="mt-3 text-xs text-slate-400">Tenant workspace: <span className="font-mono">https://{t.slug}.gocampusos.com</span></p>}
      </Card>
    </div>
  );
}

function CommunicationTab({ t, busy, onSave }: { t: Tenant; busy: boolean; onSave: (c: Record<string, unknown>) => void }) {
  const c = ((t.settings?.communication as Record<string, unknown>) ?? {});
  const [comm, setComm] = useState<Record<string, unknown>>(c);
  const str = (k: string) => (typeof comm[k] === "string" ? (comm[k] as string) : "");
  const setStr = (k: string, v: string) => setComm((o) => ({ ...o, [k]: v.trim() === "" ? null : v.trim() }));
  const [testTo, setTestTo] = useState(t.email ?? "");
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const sendTest = async () => {
    setTestMsg(null);
    try { await api.post("/platform/email/test", { to: testTo }); setTestMsg("Test email sent."); }
    catch (e) { setTestMsg(e instanceof ApiError ? e.message : "Email is not configured."); }
  };
  return (
    <div className="space-y-4">
      <Card>
        <p className="mb-1 text-sm font-medium text-slate-700">Communication settings</p>
        <p className="mb-3 text-xs text-slate-400">Sender identity & channels for this tenant. Delivery depends on the platform SMTP/SMS configuration. SMTP secrets are never shown here.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email sender name"><Input value={str("emailSenderName")} onChange={(e) => setStr("emailSenderName", e.target.value)} /></Field>
          <Field label="Reply-to email"><Input value={str("replyToEmail")} onChange={(e) => setStr("replyToEmail", e.target.value)} /></Field>
          <Field label="SMS sender ID"><Input value={str("smsSenderId")} onChange={(e) => setStr("smsSenderId", e.target.value)} /></Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-4">
          <Check obj={comm} set={setComm} k="notifyEmail" label="Email notifications" />
          <Check obj={comm} set={setComm} k="notifySms" label="SMS notifications" />
          <Check obj={comm} set={setComm} k="whatsappEnabled" label="WhatsApp enabled" />
        </div>
        <div className="mt-3"><Button disabled={busy} onClick={() => onSave(comm)}>Save communication</Button></div>
      </Card>
      <Card>
        <p className="mb-2 text-sm font-medium text-slate-700">Send test email</p>
        <div className="flex items-end gap-2">
          <div className="flex-1"><Field label="To"><Input value={testTo} onChange={(e) => setTestTo(e.target.value)} /></Field></div>
          <Button variant="secondary" onClick={sendTest} disabled={!testTo.trim()}>Send test</Button>
        </div>
        {testMsg && <p className="mt-2 text-xs text-slate-500">{testMsg}</p>}
      </Card>
    </div>
  );
}

function HealthTab({ id, t }: { id: string; t: Tenant }) {
  const [h, setH] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.get<Record<string, unknown>>(`/platform/tenants/${id}/health`).then(setH).catch((e) => setErr(e instanceof ApiError ? e.message : "Failed to load health")); }, [id]);
  if (err) return <ErrorNote message={err} />;
  if (!h) return <Spinner />;
  const usage = (h.usage ?? {}) as Record<string, number>;
  const billing = (h.billing ?? {}) as Record<string, unknown>;
  const last = h.lastSessionActivity ? new Date(String(h.lastSessionActivity)).toLocaleString() : "no sessions yet";
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Active sessions" value={formatNumber(usage.activeSessions)} />
        <Tile label="Users" value={formatNumber(usage.users)} />
        <Tile label="Students" value={formatNumber(usage.students)} />
        <Tile label="Staff" value={formatNumber(usage.staff)} />
        <Tile label="Storage used" value={formatBytes(Number(h.storageBytes))} />
        <Tile label="Locked accounts" value={formatNumber(Number(h.lockedAccounts))} hint={`${formatNumber(Number(h.failingLogins))} with failed logins`} />
        <Tile label="In-app messages" value={formatNumber(Number(h.inAppMessages))} />
        <Tile label="Tenant documents" value={formatNumber(Number(h.documents))} />
        <Tile label="Onboarding" value={`${t.onboardingProgress.completion}%`} />
        <Tile label="Outstanding" value={`${t.currency ?? "INR"} ${Number(billing.outstanding ?? 0).toFixed(2)}`} hint={`${Number(billing.overdueCount ?? 0)} overdue`} />
        <Tile label="Subscription" value={billing.subscription ? String((billing.subscription as Record<string, unknown>).status) : "none"} />
        <Tile label="Last session activity" value={last} />
      </div>
      <p className="text-xs text-slate-400">All figures are from live data. Per-user last-login, SMS/email send counts and failed-login history are not tracked by the platform, so they are intentionally omitted rather than estimated.</p>
    </div>
  );
}

function ComplianceTab({ t, busy, onSave }: { t: Tenant; busy: boolean; onSave: (b: Record<string, unknown>) => void }) {
  const [f, setF] = useState({
    termsAccepted: t.termsAccepted, agreementSigned: t.agreementSigned, dataProcessingConsent: t.dataProcessingConsent,
    kycStatus: t.kycStatus, approvalStatus: t.approvalStatus, approvalRemarks: t.approvalRemarks ?? "",
  });
  return (
    <Card>
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={f.termsAccepted} onChange={(e) => setF({ ...f, termsAccepted: e.target.checked })} /> Terms accepted</label>
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={f.agreementSigned} onChange={(e) => setF({ ...f, agreementSigned: e.target.checked })} /> Agreement signed</label>
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={f.dataProcessingConsent} onChange={(e) => setF({ ...f, dataProcessingConsent: e.target.checked })} /> Data-processing consent</label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="KYC / verification status"><Select value={f.kycStatus} onChange={(e) => setF({ ...f, kycStatus: e.target.value })}>{["pending", "verified", "rejected"].map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field>
          <Field label="Approval status"><Select value={f.approvalStatus} onChange={(e) => setF({ ...f, approvalStatus: e.target.value })}>{["pending", "approved", "rejected"].map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field>
        </div>
        <Field label="Approval remarks"><Textarea rows={2} value={f.approvalRemarks} onChange={(e) => setF({ ...f, approvalRemarks: e.target.value })} /></Field>
        {t.approvedAt && <p className="text-xs text-slate-400">Last approved/updated: {new Date(t.approvedAt).toLocaleString()}</p>}
      </div>
      <div className="mt-3"><Button disabled={busy} onClick={() => onSave({ ...f, approvalRemarks: f.approvalRemarks.trim() || null })}>Save compliance</Button></div>
    </Card>
  );
}

function NotesTab({ id, t, busy, onSaveCrm }: { id: string; t: Tenant; busy: boolean; onSaveCrm: (b: Record<string, unknown>) => void }) {
  interface Note { id: string; noteType: string; body: string; followUpDate: string | null; authorEmail: string | null; createdAt: string }
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteType, setNoteType] = useState("general");
  const [body, setBody] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [nbusy, setNbusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [accountManager, setAccountManager] = useState(t.accountManager ?? "");
  const [lastContacted, setLastContacted] = useState(t.lastContactedAt ? String(t.lastContactedAt).slice(0, 10) : "");
  const load = useCallback(async () => { setNotes(await api.get<Note[]>(`/platform/tenants/${id}/notes`).catch(() => [])); }, [id]);
  useEffect(() => { load(); }, [load]);
  const add = async () => { if (!body.trim()) return; setNbusy(true); try { setNotes(await api.post<Note[]>(`/platform/tenants/${id}/notes`, { noteType, body: body.trim(), followUpDate: followUp || null })); setBody(""); setFollowUp(""); } finally { setNbusy(false); } };
  const del = async (noteId: string) => { setNbusy(true); try { setNotes(await api.delete<Note[]>(`/platform/tenants/notes/${noteId}`)); } finally { setNbusy(false); } };
  const startEdit = (n: Note) => { setEditId(n.id); setEditBody(n.body); };
  const saveEdit = async () => { if (!editId || !editBody.trim()) return; setNbusy(true); try { setNotes(await api.patch<Note[]>(`/platform/tenants/notes/${editId}`, { body: editBody.trim() })); setEditId(null); setEditBody(""); } finally { setNbusy(false); } };
  return (
    <div className="space-y-4">
      <Card>
        <p className="mb-2 text-sm font-medium text-slate-700">Account ownership</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Account manager / owner"><Input value={accountManager} onChange={(e) => setAccountManager(e.target.value)} /></Field>
          <Field label="Last contacted"><Input type="date" value={lastContacted} onChange={(e) => setLastContacted(e.target.value)} /></Field>
        </div>
        <div className="mt-3"><Button disabled={busy} onClick={() => onSaveCrm({ accountManager: accountManager.trim() || null, lastContactedAt: lastContacted ? new Date(lastContacted).toISOString() : null })}>Save</Button></div>
      </Card>
      <Card>
        <p className="mb-2 text-sm font-medium text-slate-700">Internal notes (super-admin only)</p>
        <div className="grid grid-cols-12 gap-2">
          <div className="col-span-3"><Select value={noteType} onChange={(e) => setNoteType(e.target.value)}>{["sales", "support", "billing", "technical", "general"].map((x) => <option key={x} value={x}>{x}</option>)}</Select></div>
          <div className="col-span-5"><Input placeholder="Add a note…" value={body} onChange={(e) => setBody(e.target.value)} /></div>
          <div className="col-span-2"><Input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} /></div>
          <div className="col-span-2"><Button disabled={nbusy || !body.trim()} onClick={add}>Add</Button></div>
        </div>
      </Card>
      <Card>
        {notes.length === 0 ? <p className="text-sm text-slate-400">No notes yet.</p> : (
          <ul className="divide-y divide-slate-100">
            {notes.map((n) => (
              <li key={n.id} className="flex items-start justify-between gap-2 py-2 text-sm">
                {editId === n.id ? (
                  <span className="flex flex-1 items-center gap-2">
                    <Input value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                    <button className="text-xs text-emerald-600 hover:text-emerald-700 disabled:opacity-50" disabled={nbusy || !editBody.trim()} onClick={saveEdit}>Save</button>
                    <button className="text-xs text-slate-500 hover:text-slate-700" onClick={() => setEditId(null)}>Cancel</button>
                  </span>
                ) : (
                  <>
                    <span><Badge tone="slate">{n.noteType}</Badge> <span className="text-slate-700">{n.body}</span>{n.followUpDate && <span className="ml-2 text-xs text-amber-600">follow-up {n.followUpDate}</span>}<span className="ml-2 text-xs text-slate-400">{n.authorEmail} · {new Date(n.createdAt).toLocaleDateString()}</span></span>
                    <span className="flex shrink-0 gap-3">
                      <button className="text-xs text-brand-600 hover:text-brand-700 disabled:opacity-50" disabled={nbusy} onClick={() => startEdit(n)}>Edit</button>
                      <button className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50" disabled={nbusy} onClick={() => del(n.id)}>Delete</button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function SupportTab({ id, setNotice, setError }: { id: string; setNotice: (s: string | null) => void; setError: (s: string | null) => void }) {
  interface U { id: string; fullName: string; email: string; role: string }
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<U[]>([]);
  const [reason, setReason] = useState("");
  const [active, setActive] = useState<{ email: string; expiresAt: string } | null>(null);
  const search = async () => {
    try { setUsers(await api.get<U[]>(`/platform/users?institutionId=${id}&q=${encodeURIComponent(q)}&limit=20`)); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Search failed"); }
  };
  const start = async (u: U) => {
    if (reason.trim().length < 8) { setError("A reason of at least 8 characters is required"); return; }
    setError(null);
    try {
      const r = await api.post<{ expiresAt: string }>("/platform/impersonate", { userId: u.id, reason: reason.trim() });
      setActive({ email: u.email, expiresAt: r.expiresAt }); setNotice(`Support session started for ${u.email}.`);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not start session"); }
  };
  const end = async () => {
    try { await api.post("/platform/impersonate/end", {}); setActive(null); setNotice("Support session ended."); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not end session"); }
  };
  return (
    <div className="space-y-4">
      {active && (
        <div className="flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span>Active support session for <b>{active.email}</b> · expires {new Date(active.expiresAt).toLocaleString()}</span>
          <Button variant="secondary" onClick={end}>End session</Button>
        </div>
      )}
      <Card>
        <p className="mb-2 text-sm font-medium text-slate-700">Support access (impersonation)</p>
        <p className="mb-3 text-xs text-slate-400">Search this tenant&apos;s users, give a reason (≥8 chars), and start a time-boxed, audited session. Only one active session is allowed at a time. For full impersonated browsing use the <Link href="/super-admin/platform/support" className="text-brand-600">Support Access console</Link>.</p>
        <Field label="Reason (mandatory)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. investigating reported fee-report bug" /></Field>
        <div className="mt-2 flex gap-2">
          <Input placeholder="Search name / email…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button variant="secondary" onClick={search}>Search</Button>
        </div>
        <ul className="mt-3 divide-y divide-slate-100">
          {users.map((u) => (
            <li key={u.id} className="flex items-center justify-between py-2 text-sm">
              <span><span className="font-medium text-slate-900">{u.fullName}</span> <span className="text-slate-500">{u.email}</span> <Badge tone="slate">{u.role}</Badge></span>
              <button className="text-xs text-brand-600 hover:text-brand-700" onClick={() => start(u)}>Start session</button>
            </li>
          ))}
          {users.length === 0 && <li className="py-2 text-sm text-slate-400">No users loaded — search above.</li>}
        </ul>
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
