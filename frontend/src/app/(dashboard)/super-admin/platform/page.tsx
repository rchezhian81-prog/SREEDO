"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Input,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { PlatformHealth, PlatformKpis, PlatformRevenue } from "@/types";
import { formatMoney } from "@/lib/format";
import { usePlatformGuard } from "./_guard";
import { formatBytes, formatNumber, formatUptime } from "./_utils";

interface EmailStatus {
  configured: boolean;
  ok: boolean;
  error?: string | null;
}

type AlertTone = "red" | "amber";
interface PlatformAlert {
  tone: AlertTone;
  text: string;
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card>
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </Card>
  );
}

function HealthChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <span className="text-sm font-medium text-slate-600">{label}</span>
      <Badge tone={ok ? "green" : "red"}>{ok ? "online" : "offline"}</Badge>
    </div>
  );
}

const ADOPTION_FIELDS: {
  key: keyof PlatformKpis["moduleAdoption"];
  label: string;
}[] = [
  { key: "withStudents", label: "Students" },
  { key: "withFees", label: "Fees" },
  { key: "withOnlinePayments", label: "Online payments" },
  { key: "withLibrary", label: "Library" },
  { key: "withScheduledReports", label: "Scheduled reports" },
];

export default function PlatformDashboardPage() {
  const { ready, gate } = usePlatformGuard(
    "Platform overview",
    "Cross-tenant KPIs, module adoption & platform health"
  );

  const [kpis, setKpis] = useState<PlatformKpis | null>(null);
  const [health, setHealth] = useState<PlatformHealth | null>(null);
  const [email, setEmail] = useState<EmailStatus | null>(null);
  const [revenue, setRevenue] = useState<PlatformRevenue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const [testTo, setTestTo] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [k, h, e, r] = await Promise.all([
        api.get<PlatformKpis>("/platform/kpis"),
        api.get<PlatformHealth>("/platform/health").catch(() => null),
        api.get<EmailStatus>("/platform/email/status").catch(() => null),
        api.get<PlatformRevenue>("/platform/revenue").catch(() => null),
      ]);
      setKpis(k);
      setHealth(h);
      setEmail(e);
      setRevenue(r);
      setRefreshedAt(new Date());
    } catch (err) {
      setKpis(null);
      setError(
        err instanceof ApiError ? err.message : "Failed to load platform KPIs"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const sendTestEmail = async () => {
    if (!testTo.trim()) return;
    setTestBusy(true);
    setTestMsg(null);
    try {
      const r = await api.post<{ ok: boolean; error?: string }>(
        "/platform/email/test",
        { to: testTo.trim() }
      );
      setTestMsg(r.ok ? `Test email sent to ${testTo.trim()}.` : `Failed: ${r.error ?? "unknown error"}`);
    } catch (err) {
      setTestMsg(err instanceof ApiError ? err.message : "Failed to send test email");
    } finally {
      setTestBusy(false);
    }
  };

  // Alerts derived ONLY from real data (no fabricated values).
  const alerts: PlatformAlert[] = [];
  if (kpis && kpis.suspendedInstitutions > 0)
    alerts.push({
      tone: "amber",
      text: `${formatNumber(kpis.suspendedInstitutions)} institution(s) suspended`,
    });
  if (kpis && Number(kpis.feesOutstanding) > 0)
    alerts.push({
      tone: "amber",
      text: `Tenant fees outstanding: ${formatNumber(kpis.feesOutstanding)}`,
    });
  if (health) {
    if (!health.postgres) alerts.push({ tone: "red", text: "PostgreSQL is offline" });
    if (!health.mongo) alerts.push({ tone: "red", text: "MongoDB is offline" });
    if (!health.auditLog) alerts.push({ tone: "red", text: "Audit log is unavailable" });
  }
  if (email && !email.configured)
    alerts.push({ tone: "amber", text: "SMTP is not configured — email is disabled" });
  else if (email && email.configured && !email.ok)
    alerts.push({ tone: "red", text: `SMTP error: ${email.error ?? "connection failed"}` });

  if (!ready) return gate;

  return (
    <>
      <PageHeader
        title="Platform overview"
        subtitle="Cross-tenant KPIs, module adoption & platform health"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {refreshedAt && (
              <span className="text-xs text-slate-400">
                Updated {refreshedAt.toLocaleTimeString()}
              </span>
            )}
            <Button variant="secondary" onClick={load} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
        }
      />

      {/* Quick actions */}
      <div className="mb-6 flex flex-wrap gap-2">
        <Link href="/super-admin/platform/tenants/new"><Button>+ Add tenant</Button></Link>
        <Link href="/super-admin/platform/tenants"><Button variant="secondary">Tenants</Button></Link>
        <Link href="/super-admin/invoices"><Button variant="secondary">Invoices</Button></Link>
        <Link href="/super-admin/packages"><Button variant="secondary">Packages</Button></Link>
        <Link href="/super-admin/subscriptions"><Button variant="secondary">Subscriptions</Button></Link>
        <Link href="/super-admin/revenue"><Button variant="secondary">Revenue</Button></Link>
        <Link href="/super-admin/platform/audit"><Button variant="secondary">Audit</Button></Link>
        <Link href="/super-admin/platform/support"><Button variant="secondary">Support</Button></Link>
        <Link href="/super-admin/backups"><Button variant="secondary">Backups</Button></Link>
        <Link href="/super-admin/health"><Button variant="secondary">Health</Button></Link>
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : kpis ? (
        <div className="space-y-8">
          {/* Alerts (real data only) */}
          {alerts.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Alerts
              </h2>
              <div className="space-y-2">
                {alerts.map((a, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                      a.tone === "red"
                        ? "border-red-200 bg-red-50 text-red-700"
                        : "border-amber-200 bg-amber-50 text-amber-700"
                    }`}
                  >
                    <Badge tone={a.tone}>{a.tone === "red" ? "critical" : "warning"}</Badge>
                    <span>{a.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Health */}
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Platform health
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {health ? (
                <>
                  <HealthChip label="API" ok={true} />
                  <HealthChip label="PostgreSQL" ok={health.postgres} />
                  <HealthChip label="MongoDB" ok={health.mongo} />
                  <HealthChip label="Audit log" ok={health.auditLog} />
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                    Uptime{" "}
                    <span className="font-medium text-slate-900">
                      {formatUptime(health.uptimeSeconds)}
                    </span>
                  </div>
                </>
              ) : (
                <span className="text-sm text-slate-400">Health unavailable</span>
              )}
              {email && (
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <span className="text-sm font-medium text-slate-600">SMTP</span>
                  <Badge tone={!email.configured ? "slate" : email.ok ? "green" : "red"}>
                    {!email.configured ? "not configured" : email.ok ? "ok" : "error"}
                  </Badge>
                </div>
              )}
            </div>
            {/* SMTP test (no secrets shown; audited server-side) */}
            {email?.configured && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  className="max-w-xs"
                />
                <Button variant="secondary" onClick={sendTestEmail} disabled={testBusy || !testTo.trim()}>
                  {testBusy ? "Sending…" : "Send test email"}
                </Button>
                {testMsg && <span className="text-xs text-slate-500">{testMsg}</span>}
              </div>
            )}
          </div>

          {/* KPI grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Institutions"
              value={formatNumber(kpis.totalInstitutions)}
              hint={`${formatNumber(kpis.activeInstitutions)} active · ${formatNumber(
                kpis.suspendedInstitutions
              )} suspended`}
            />
            <KpiCard
              label="Active subscriptions"
              value={formatNumber(kpis.activeSubscriptions)}
            />
            <KpiCard label="Students" value={formatNumber(kpis.totalStudents)} />
            <KpiCard label="Staff" value={formatNumber(kpis.totalStaff)} />
            <KpiCard label="Users" value={formatNumber(kpis.totalUsers)} />
            <KpiCard label="Fees outstanding" value={formatNumber(kpis.feesOutstanding)} />
            <KpiCard label="Online payments" value={formatNumber(kpis.onlinePaymentsTotal)} />
            <KpiCard label="Active sessions" value={formatNumber(kpis.activeSessions)} />
            <KpiCard
              label="Documents"
              value={formatNumber(kpis.totalDocuments)}
              hint={`${formatBytes(kpis.storageBytes)} stored`}
            />
            <KpiCard label="Storage" value={formatBytes(kpis.storageBytes)} />
            <KpiCard label="Scheduled reports" value={formatNumber(kpis.scheduledReports)} />
            <KpiCard label="Custom reports" value={formatNumber(kpis.customReports)} />
          </div>

          {/* Revenue (SaaS operator) */}
          {revenue && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Revenue
                </h2>
                <Link
                  href="/super-admin/revenue"
                  className="text-xs font-medium text-brand-600 hover:underline"
                >
                  View report →
                </Link>
              </div>
              {revenue.mixedCurrency && (
                <p className="mb-3 text-xs text-amber-600">
                  Multiple currencies — headline shown in {revenue.currency}.
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard label="MRR" value={formatMoney(revenue.mrr, revenue.currency)} />
                <KpiCard label="ARR" value={formatMoney(revenue.arr, revenue.currency)} />
                <KpiCard
                  label="Deferred revenue"
                  value={formatMoney(revenue.deferredRevenue, revenue.currency)}
                />
                <KpiCard
                  label="Active / trialing"
                  value={`${formatNumber(revenue.byStatus.active)} / ${formatNumber(
                    revenue.trialingCount
                  )}`}
                />
              </div>
            </div>
          )}

          {/* Module adoption */}
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Module adoption
            </h2>
            <p className="mb-3 text-xs text-slate-400">
              Institutions actively using each module (of{" "}
              {formatNumber(kpis.totalInstitutions)} total).
            </p>
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {ADOPTION_FIELDS.map((field) => (
                <Card key={field.key}>
                  <p className="text-sm font-medium text-slate-500">{field.label}</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">
                    {formatNumber(kpis.moduleAdoption[field.key])}
                  </p>
                </Card>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
