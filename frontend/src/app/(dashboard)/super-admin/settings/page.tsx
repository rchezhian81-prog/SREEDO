"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
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
  Textarea,
} from "@/components/ui";
import { usePlatformGuard } from "../platform/_guard";

// ---------------------------------------------------------------------------
// Types (mirror the backend response shapes)
// ---------------------------------------------------------------------------
interface PlatformSettings {
  platformName: string;
  platformDisplayName: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  defaultCountry: string | null;
  defaultState: string | null;
  defaultTimezone: string;
  defaultCurrency: string;
  defaultLanguage: string;
  academicYearFormat: string;
  dateFormat: string;
  timeFormat: "12h" | "24h";
  financialYearStartMonth: number;
  internalNotes: string | null;
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  maintenanceStartsAt: string | null;
  maintenanceEndsAt: string | null;
  announcementActive: boolean;
  announcementText: string | null;
  announcementVisibility: "super_admin" | "tenant_admins" | "all_users";
  updatedAt: string;
}
interface Info {
  environment: string;
  appUrl: string | null;
  apiDocsEnabled: boolean;
  email: { configured: boolean; from: string };
  storage: { configured: boolean; mode: string; region: string; maxMb: number };
  sms: { configured: boolean; provider: string | null; sender: string };
  push: { configured: boolean };
  ai: { configured: boolean; model: string };
  payments: { configured: boolean; provider: string | null; currency: string };
  security: {
    maxFailedAttempts: number;
    lockoutMinutes: number;
    accessTokenTtl: string;
    refreshTokenTtlDays: number;
    passwordResetTtlMinutes: number;
    rateLimitWindowMinutes: number;
    rateLimitMax: number;
  };
  billing: { graceDays: number; reminderDays: number[]; autoSuspend: boolean; enforceSubscription: boolean };
  company: { name: string; email: string | null; gstinConfigured: boolean };
}
interface FeatureFlag {
  id: string;
  key: string;
  displayName: string;
  description: string | null;
  defaultValue: boolean;
  status: "enabled" | "disabled" | "rollout";
  scope: "global" | "tenant" | "package";
  rolloutPercentage: number | null;
  allowedTenants: string[];
  createdByEmail: string | null;
  updatedByEmail: string | null;
  createdAt: string;
  updatedAt: string;
}
interface HistoryRow {
  id: string;
  action: string;
  targetType: string;
  actorEmail: string | null;
  actorRole: string | null;
  detail: { diff?: Record<string, { from: unknown; to: unknown }>; [k: string]: unknown };
  ip: string | null;
  createdAt: string;
}
interface EmailStatus { configured: boolean; ok: boolean; error?: string }
interface BackupSettings {
  retentionCount: number | null;
  scheduleEnabled: boolean;
  scheduleFrequency: string;
  scheduleRunTime: string;
  nextRunAt: string | null;
}
interface TenantRow { id: string; name: string; code: string; institutionType: string; status: string }

const SECTIONS = ["General", "Tenant Hub", "Feature Flags", "Status", "History"] as const;
type Section = (typeof SECTIONS)[number];

const dtLocal = (iso: string | null) => (iso ? iso.slice(0, 16) : "");
const fmt = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "—");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Tenant tab deep-link helpers (the tenant detail page reads ?tab=<slug>).
const TENANT_TABS: { label: string; slug: string }[] = [
  { label: "Profile", slug: "profile" },
  { label: "Academic", slug: "academic-structure" },
  { label: "Settings", slug: "settings" },
  { label: "Modules", slug: "modules" },
  { label: "Branding & Domain", slug: "branding-domain" },
  { label: "Communication", slug: "communication" },
  { label: "Subscription & Billing", slug: "subscription-billing" },
  { label: "Limits & Usage", slug: "limits-usage" },
  { label: "Compliance", slug: "compliance" },
];

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{children}</h2>;
}
function StatusDot({ ok }: { ok: boolean }) {
  return <Badge tone={ok ? "green" : "amber"}>{ok ? "Configured" : "Not configured"}</Badge>;
}

export default function PlatformSettingsPage() {
  const { ready, gate } = usePlatformGuard("Settings", "Global platform settings & feature governance");
  const [section, setSection] = useState<Section>("General");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [form, setForm] = useState<PlatformSettings | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [emailStatus, setEmailStatus] = useState<EmailStatus | null>(null);
  const [backup, setBackup] = useState<BackupSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!notice) return;
    const x = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(x);
  }, [notice]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, i, f, h, em, bk] = await Promise.all([
        api.get<PlatformSettings>("/platform/settings"),
        api.get<Info>("/platform/settings/info"),
        api.get<FeatureFlag[]>("/platform/feature-flags"),
        api.get<{ rows: HistoryRow[] }>("/platform/settings/history?pageSize=50"),
        api.get<EmailStatus>("/platform/email/status").catch(() => null),
        api.get<BackupSettings>("/backups/settings").catch(() => null),
      ]);
      setSettings(s);
      setForm(s);
      setInfo(i);
      setFlags(f);
      setHistory(h.rows);
      setEmailStatus(em);
      setBackup(bk);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  if (!ready) return gate;

  return (
    <>
      <PageHeader
        title="Platform Settings"
        subtitle="Global platform settings & feature governance. Tenant-specific settings live inside each tenant."
        action={
          <Button variant="secondary" onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />

      {notice && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>
      )}
      {error && <ErrorNote message={error} />}

      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {SECTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition " +
              (section === s
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-700")
            }
          >
            {s}
          </button>
        ))}
      </div>

      {loading || !form ? (
        <Spinner />
      ) : (
        <>
          {section === "General" && (
            <GeneralSection
              form={form}
              setForm={setForm}
              baseline={settings}
              saving={saving}
              onSave={async (payload) => {
                setSaving(true);
                setError(null);
                try {
                  const next = await api.patch<PlatformSettings>("/platform/settings", payload);
                  setSettings(next);
                  setForm(next);
                  setNotice("Settings saved.");
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : "Failed to save settings");
                } finally {
                  setSaving(false);
                }
              }}
            />
          )}
          {section === "Tenant Hub" && <TenantHub />}
          {section === "Feature Flags" && (
            <FeatureFlagsSection
              flags={flags}
              onChanged={(msg) => {
                setNotice(msg);
                load();
              }}
              onError={setError}
            />
          )}
          {section === "Status" && (
            <StatusSection info={info} emailStatus={emailStatus} backup={backup} onNotice={setNotice} onError={setError} />
          )}
          {section === "History" && (
            <HistorySection
              rows={history}
              onRolledBack={() => {
                setNotice("Setting rolled back.");
                load();
              }}
              onError={setError}
            />
          )}
        </>
      )}
    </>
  );
}

// ===========================================================================
// General — global platform settings + maintenance/announcement
// ===========================================================================
const NULLABLE = new Set([
  "platformDisplayName", "supportEmail", "supportPhone", "defaultCountry", "defaultState",
  "internalNotes", "maintenanceMessage", "maintenanceStartsAt", "maintenanceEndsAt", "announcementText",
]);

function GeneralSection({
  form, setForm, baseline, saving, onSave,
}: {
  form: PlatformSettings;
  setForm: React.Dispatch<React.SetStateAction<PlatformSettings | null>>;
  baseline: PlatformSettings | null;
  saving: boolean;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  const [confirmMaintenance, setConfirmMaintenance] = useState(false);
  const set = <K extends keyof PlatformSettings>(k: K, v: PlatformSettings[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  const buildPayload = () => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(form)) {
      if (k === "updatedAt") continue;
      if (typeof v === "string" && NULLABLE.has(k)) out[k] = v.trim() === "" ? null : v.trim();
      else out[k] = v;
    }
    return out;
  };
  const submit = () => {
    if (form.maintenanceMode && !baseline?.maintenanceMode) {
      setConfirmMaintenance(true);
      return;
    }
    onSave(buildPayload());
  };

  return (
    <div className="space-y-4">
      <Card>
        <SectionHeading>Identity &amp; support</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Platform name"><Input value={form.platformName} onChange={(e) => set("platformName", e.target.value)} /></Field>
          <Field label="Display name"><Input value={form.platformDisplayName ?? ""} onChange={(e) => set("platformDisplayName", e.target.value)} /></Field>
          <Field label="Support email"><Input type="email" value={form.supportEmail ?? ""} onChange={(e) => set("supportEmail", e.target.value)} /></Field>
          <Field label="Support phone"><Input value={form.supportPhone ?? ""} onChange={(e) => set("supportPhone", e.target.value)} /></Field>
        </div>
      </Card>

      <Card>
        <SectionHeading>Regional defaults</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Default country"><Input value={form.defaultCountry ?? ""} onChange={(e) => set("defaultCountry", e.target.value)} /></Field>
          <Field label="Default state"><Input value={form.defaultState ?? ""} onChange={(e) => set("defaultState", e.target.value)} /></Field>
          <Field label="Default timezone"><Input value={form.defaultTimezone} onChange={(e) => set("defaultTimezone", e.target.value)} /></Field>
          <Field label="Default currency"><Input value={form.defaultCurrency} onChange={(e) => set("defaultCurrency", e.target.value.toUpperCase())} /></Field>
          <Field label="Default language"><Input value={form.defaultLanguage} onChange={(e) => set("defaultLanguage", e.target.value)} /></Field>
        </div>
      </Card>

      <Card>
        <SectionHeading>Formats</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Academic year format"><Input value={form.academicYearFormat} onChange={(e) => set("academicYearFormat", e.target.value)} /></Field>
          <Field label="Date format"><Input value={form.dateFormat} onChange={(e) => set("dateFormat", e.target.value)} /></Field>
          <Field label="Time format">
            <Select value={form.timeFormat} onChange={(e) => set("timeFormat", e.target.value as PlatformSettings["timeFormat"])}>
              <option value="24h">24-hour</option>
              <option value="12h">12-hour</option>
            </Select>
          </Field>
          <Field label="Financial year start month">
            <Select value={String(form.financialYearStartMonth)} onChange={(e) => set("financialYearStartMonth", Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleString("en", { month: "long" })}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Internal platform notes (visible to super-admins only)">
            <Textarea rows={3} value={form.internalNotes ?? ""} onChange={(e) => set("internalNotes", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card>
        <SectionHeading>Maintenance mode</SectionHeading>
        <p className="mb-3 text-xs text-slate-400">When on, an in-app banner is shown to signed-in users. This does not forcibly block traffic.</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={form.maintenanceMode} onChange={(e) => set("maintenanceMode", e.target.checked)} />
          Maintenance mode enabled
        </label>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Message"><Input value={form.maintenanceMessage ?? ""} onChange={(e) => set("maintenanceMessage", e.target.value)} placeholder="Scheduled maintenance in progress…" /></Field>
          <div />
          <Field label="Starts at"><Input type="datetime-local" value={dtLocal(form.maintenanceStartsAt)} onChange={(e) => set("maintenanceStartsAt", e.target.value || null)} /></Field>
          <Field label="Ends at"><Input type="datetime-local" value={dtLocal(form.maintenanceEndsAt)} onChange={(e) => set("maintenanceEndsAt", e.target.value || null)} /></Field>
        </div>
      </Card>

      <Card>
        <SectionHeading>Platform announcement</SectionHeading>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={form.announcementActive} onChange={(e) => set("announcementActive", e.target.checked)} />
          Announcement active
        </label>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Announcement text"><Input value={form.announcementText ?? ""} onChange={(e) => set("announcementText", e.target.value)} /></Field>
          <Field label="Visible to">
            <Select value={form.announcementVisibility} onChange={(e) => set("announcementVisibility", e.target.value as PlatformSettings["announcementVisibility"])}>
              <option value="super_admin">Super-admins only</option>
              <option value="tenant_admins">Tenant admins</option>
              <option value="all_users">All users</option>
            </Select>
          </Field>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button>
        <span className="text-xs text-slate-400">Last updated {fmt(form.updatedAt)}</span>
      </div>

      <ConfirmDialog
        open={confirmMaintenance}
        title="Enable maintenance mode?"
        tone="danger"
        message="Signed-in users will see a maintenance banner across the app. Continue?"
        confirmLabel="Enable & save"
        busy={saving}
        onConfirm={() => { setConfirmMaintenance(false); onSave(buildPayload()); }}
        onClose={() => setConfirmMaintenance(false)}
      />
    </div>
  );
}

// ===========================================================================
// Tenant Hub — tenant settings live inside the Tenant module
// ===========================================================================
function TenantHub() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const p = new URLSearchParams({ pageSize: "15", sort: "name", order: "asc" });
        if (q.trim()) p.set("q", q.trim());
        const data = await api.get<{ rows: TenantRow[] }>(`/platform/tenants?${p.toString()}`);
        setRows(data.rows);
      } catch {
        setRows([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-700">Tenant-specific settings live inside each tenant</p>
            <p className="text-xs text-slate-400">Profile, academic structure, school/college settings, modules, branding &amp; domain, communication, billing, limits and compliance are all managed per tenant.</p>
          </div>
          <Link href="/super-admin/platform/tenants"><Button>Open Tenant Management</Button></Link>
        </div>
      </Card>

      <Card>
        <SectionHeading>Find a tenant</SectionHeading>
        <Input placeholder="Search by name / code / email / slug…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" />
        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState message={q ? "No tenants match." : "Start typing to find a tenant."} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((t) => (
              <li key={t.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">
                    <span className="font-medium text-slate-900">{t.name}</span>{" "}
                    <span className="font-mono text-xs text-slate-400">{t.code}</span> · <span className="capitalize">{t.institutionType}</span> · <Badge tone="slate">{t.status}</Badge>
                  </span>
                  <Link href={`/super-admin/platform/tenants/${t.id}`} className="text-xs font-medium text-brand-600 hover:text-brand-700">Open tenant →</Link>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {TENANT_TABS.map((tab) => (
                    <Link
                      key={tab.slug}
                      href={`/super-admin/platform/tenants/${t.id}?tab=${tab.slug}`}
                      className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:border-brand-300 hover:text-brand-700"
                    >
                      {tab.label}
                    </Link>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ===========================================================================
// Feature Flags
// ===========================================================================
const flagTone = (s: string) => (s === "enabled" ? "green" : s === "rollout" ? "blue" : "slate");

function FeatureFlagsSection({
  flags, onChanged, onError,
}: {
  flags: FeatureFlag[];
  onChanged: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [editing, setEditing] = useState<FeatureFlag | "new" | null>(null);
  const [toggle, setToggle] = useState<{ flag: FeatureFlag; to: "enabled" | "disabled" } | null>(null);
  const [busy, setBusy] = useState(false);

  const doToggle = async () => {
    if (!toggle) return;
    setBusy(true);
    try {
      await api.post(`/platform/feature-flags/${toggle.flag.id}/status`, { status: toggle.to });
      setToggle(null);
      onChanged(`Flag "${toggle.flag.key}" ${toggle.to}.`);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to update flag");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">Govern platform feature flags. A flag here is audited governance; wiring a flag to a feature is done deliberately per feature.</p>
        <Button onClick={() => setEditing("new")}>+ New flag</Button>
      </div>
      {flags.length === 0 ? (
        <EmptyState message="No feature flags yet." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Flag</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Scope</th>
                <th className="px-4 py-3">Default</th><th className="px-4 py-3">Updated by</th><th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {flags.map((f) => (
                <tr key={f.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{f.displayName}</div>
                    <div className="font-mono text-xs text-slate-400">{f.key}</div>
                  </td>
                  <td className="px-4 py-3"><Badge tone={flagTone(f.status)}>{f.status}{f.status === "rollout" && f.rolloutPercentage != null ? ` ${f.rolloutPercentage}%` : ""}</Badge></td>
                  <td className="px-4 py-3 capitalize">{f.scope}</td>
                  <td className="px-4 py-3">{f.defaultValue ? "on" : "off"}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{f.updatedByEmail ?? "—"}<div className="text-slate-400">{fmt(f.updatedAt)}</div></td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      {f.status === "enabled" ? (
                        <Button variant="secondary" onClick={() => setToggle({ flag: f, to: "disabled" })}>Disable</Button>
                      ) : (
                        <Button variant="secondary" onClick={() => setToggle({ flag: f, to: "enabled" })}>Enable</Button>
                      )}
                      <Button variant="ghost" onClick={() => setEditing(f)}>Edit</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {editing && (
        <FlagModal
          flag={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); onChanged(msg); }}
          onError={onError}
        />
      )}
      <ConfirmDialog
        open={!!toggle}
        title={toggle?.to === "enabled" ? "Enable feature flag?" : "Disable feature flag?"}
        tone={toggle?.to === "enabled" ? "primary" : "danger"}
        message={`This will set "${toggle?.flag.key}" to ${toggle?.to}. The change is audited.`}
        confirmLabel={toggle?.to === "enabled" ? "Enable" : "Disable"}
        busy={busy}
        onConfirm={doToggle}
        onClose={() => setToggle(null)}
      />
    </div>
  );
}

function FlagModal({
  flag, onClose, onSaved, onError,
}: {
  flag: FeatureFlag | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const isNew = !flag;
  const [key, setKey] = useState(flag?.key ?? "");
  const [displayName, setDisplayName] = useState(flag?.displayName ?? "");
  const [description, setDescription] = useState(flag?.description ?? "");
  const [defaultValue, setDefaultValue] = useState(flag?.defaultValue ?? false);
  const [status, setStatus] = useState<FeatureFlag["status"]>(flag?.status ?? "disabled");
  const [scope, setScope] = useState<FeatureFlag["scope"]>(flag?.scope ?? "global");
  const [rollout, setRollout] = useState<string>(flag?.rolloutPercentage != null ? String(flag.rolloutPercentage) : "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        displayName,
        description: description.trim() || null,
        defaultValue,
        status,
        scope,
        rolloutPercentage: status === "rollout" && rollout !== "" ? Number(rollout) : null,
      };
      if (isNew) await api.post("/platform/feature-flags", { key, ...body });
      else await api.patch(`/platform/feature-flags/${flag!.id}`, body);
      onSaved(isNew ? `Flag "${key}" created.` : `Flag "${flag!.key}" updated.`);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to save flag");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={isNew ? "New feature flag" : `Edit ${flag!.key}`} open onClose={onClose}>
      <div className="space-y-4">
        {isNew && (
          <Field label="Key (immutable, e.g. new-dashboard)">
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="feature-key" />
          </Field>
        )}
        <Field label="Display name"><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></Field>
        <Field label="Description"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as FeatureFlag["status"])}>
              <option value="disabled">Disabled</option>
              <option value="enabled">Enabled</option>
              <option value="rollout">Gradual rollout</option>
            </Select>
          </Field>
          <Field label="Scope">
            <Select value={scope} onChange={(e) => setScope(e.target.value as FeatureFlag["scope"])}>
              <option value="global">Global</option>
              <option value="tenant">Tenant-specific</option>
              <option value="package">Package/plan</option>
            </Select>
          </Field>
        </div>
        {status === "rollout" && (
          <Field label="Rollout %"><Input type="number" min={0} max={100} value={rollout} onChange={(e) => setRollout(e.target.value)} /></Field>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={defaultValue} onChange={(e) => setDefaultValue(e.target.checked)} />
          Default value on
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || (isNew && !key.trim()) || !displayName.trim()}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ===========================================================================
// Status — integrations, email, backups, security (safe, no secrets)
// ===========================================================================
function StatusSection({
  info, emailStatus, backup, onNotice, onError,
}: {
  info: Info | null;
  emailStatus: EmailStatus | null;
  backup: BackupSettings | null;
  onNotice: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);

  const sendTest = async () => {
    setTesting(true);
    try {
      const r = await api.post<{ ok: boolean; error?: string }>("/platform/email/test", { to: testTo });
      onNotice(r.ok ? `Test email sent to ${testTo}.` : `Test failed: ${r.error ?? "unknown error"}`);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to send test email");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <SectionHeading>Platform info</SectionHeading>
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Info2 label="Environment" value={info?.environment ?? "—"} />
          <Info2 label="App URL" value={info?.appUrl ?? "—"} />
          <Info2 label="API docs" value={info?.apiDocsEnabled ? "enabled" : "disabled"} />
          <Info2 label="Company" value={info?.company.name ?? "—"} />
        </dl>
        <p className="mt-3 text-xs text-slate-400">Secrets (passwords, API keys, tokens) are never shown here — only configured/missing status.</p>
      </Card>

      <Card>
        <SectionHeading>Email / SMTP</SectionHeading>
        <div className="flex flex-wrap items-center gap-3">
          <StatusDot ok={Boolean(emailStatus?.configured)} />
          {emailStatus?.configured && <Badge tone={emailStatus.ok ? "green" : "red"}>{emailStatus.ok ? "Connection OK" : "Connection error"}</Badge>}
          <span className="text-xs text-slate-400">From: {info?.email.from ?? "—"}</span>
          <Link href="/super-admin/observability" className="text-xs font-medium text-brand-600 hover:text-brand-700">Observability →</Link>
        </div>
        {emailStatus?.error && <p className="mt-2 text-xs text-red-500">{emailStatus.error}</p>}
        {emailStatus?.configured && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="w-64"><Field label="Send a test email to"><Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" /></Field></div>
            <Button variant="secondary" onClick={sendTest} disabled={testing || !testTo.trim()}>{testing ? "Sending…" : "Send test"}</Button>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionHeading>Backups</SectionHeading>
          {backup ? (
            <dl className="grid gap-2 text-sm">
              <Info2 label="Schedule" value={backup.scheduleEnabled ? `${cap(backup.scheduleFrequency)} at ${backup.scheduleRunTime}` : "Disabled"} />
              <Info2 label="Retention" value={backup.retentionCount != null ? `${backup.retentionCount} kept` : "Off"} />
              <Info2 label="Next run" value={fmt(backup.nextRunAt)} />
            </dl>
          ) : (
            <p className="text-sm text-slate-400">Backup summary unavailable.</p>
          )}
          <Link href="/super-admin/backups" className="mt-3 inline-block text-xs font-medium text-brand-600 hover:text-brand-700">Manage backups →</Link>
        </Card>

        <Card>
          <SectionHeading>Security</SectionHeading>
          {info ? (
            <dl className="grid gap-2 text-sm">
              <Info2 label="Account lockout" value={`${info.security.maxFailedAttempts} attempts → ${info.security.lockoutMinutes} min`} />
              <Info2 label="Access token" value={info.security.accessTokenTtl} />
              <Info2 label="Refresh token" value={`${info.security.refreshTokenTtlDays} days`} />
              <Info2 label="Password reset link" value={`${info.security.passwordResetTtlMinutes} min`} />
            </dl>
          ) : (
            <p className="text-sm text-slate-400">Security summary unavailable.</p>
          )}
          <Link href="/super-admin/rbac" className="mt-3 inline-block text-xs font-medium text-brand-600 hover:text-brand-700">Roles &amp; permissions →</Link>
        </Card>
      </div>

      <Card>
        <SectionHeading>Integrations</SectionHeading>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {info && (
            <>
              <IntegrationRow label="Object storage" ok={info.storage.configured} note={info.storage.mode} />
              <IntegrationRow label="SMS" ok={info.sms.configured} note={info.sms.provider ?? "—"} />
              <IntegrationRow label="Push (FCM)" ok={info.push.configured} />
              <IntegrationRow label="AI" ok={info.ai.configured} note={info.ai.model} />
              <IntegrationRow label="Payments" ok={info.payments.configured} note={info.payments.provider ?? "—"} />
              <IntegrationRow label="Email" ok={info.email.configured} />
            </>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/super-admin/invoices/settings"><Button variant="secondary">Invoice settings</Button></Link>
          <Link href="/super-admin/health"><Button variant="secondary">System health</Button></Link>
        </div>
      </Card>

      <Card>
        <SectionHeading>Maintenance &amp; announcements</SectionHeading>
        <p className="text-sm text-slate-500">Maintenance mode and platform announcements are configured in the <strong>General</strong> tab. They are persisted and audited; an in-app banner shows them to signed-in users. Forced traffic blocking and the student/parent-portal banner are planned follow-ups.</p>
      </Card>
    </div>
  );
}
function Info2({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-slate-800">{value}</dd>
    </div>
  );
}
function IntegrationRow({ label, ok, note }: { label: string; ok: boolean; note?: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
      <span className="text-sm text-slate-700">{label}{note ? <span className="text-slate-400"> · {note}</span> : null}</span>
      <StatusDot ok={ok} />
    </div>
  );
}

// ===========================================================================
// History — settings + flag change log with before/after diff + safe rollback
// ===========================================================================
const ACTION_LABEL: Record<string, string> = {
  "platform.settings_update": "Settings updated",
  "platform.settings_rollback": "Settings rolled back",
  "platform.feature_flag_create": "Flag created",
  "platform.feature_flag_update": "Flag updated",
  "platform.feature_flag_status": "Flag status changed",
};

function HistorySection({
  rows, onRolledBack, onError,
}: {
  rows: HistoryRow[];
  onRolledBack: () => void;
  onError: (m: string) => void;
}) {
  const [rollback, setRollback] = useState<HistoryRow | null>(null);
  const [busy, setBusy] = useState(false);

  const doRollback = async () => {
    if (!rollback) return;
    setBusy(true);
    try {
      await api.post("/platform/settings/rollback", { auditId: rollback.id });
      setRollback(null);
      onRolledBack();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Rollback failed");
    } finally {
      setBusy(false);
    }
  };

  if (rows.length === 0) return <EmptyState message="No settings changes recorded yet." />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">Settings &amp; feature-flag changes are audited. Global settings updates can be safely rolled back (secrets, billing history and lifecycle actions cannot).</p>
      {rows.map((r) => {
        const diff = r.detail?.diff ?? {};
        const diffKeys = Object.keys(diff);
        const canRollback = r.action === "platform.settings_update" && diffKeys.length > 0;
        return (
          <Card key={r.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <span className="text-sm font-medium text-slate-900">{ACTION_LABEL[r.action] ?? r.action}</span>
                <span className="ml-2 text-xs text-slate-400">{fmt(r.createdAt)} · {r.actorEmail ?? "system"}</span>
              </div>
              {canRollback && <Button variant="secondary" onClick={() => setRollback(r)}>Roll back</Button>}
            </div>
            {diffKeys.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs">
                {diffKeys.map((k) => (
                  <li key={k} className="font-mono text-slate-600">
                    <span className="text-slate-500">{k}:</span>{" "}
                    <span className="text-red-500 line-through">{String(diff[k].from ?? "∅")}</span>{" → "}
                    <span className="text-emerald-600">{String(diff[k].to ?? "∅")}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
      <ConfirmDialog
        open={!!rollback}
        title="Roll back this change?"
        tone="danger"
        message="The affected settings will be restored to their previous values. This is itself audited."
        confirmLabel="Roll back"
        busy={busy}
        onConfirm={doRollback}
        onClose={() => setRollback(null)}
      />
    </div>
  );
}
