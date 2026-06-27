"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { PlatformHealth, PlatformKpis } from "@/types";
import { usePlatformGuard } from "./_guard";
import { formatBytes, formatNumber, formatUptime } from "./_utils";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [k, h] = await Promise.all([
        api.get<PlatformKpis>("/platform/kpis"),
        api.get<PlatformHealth>("/platform/health").catch(() => null),
      ]);
      setKpis(k);
      setHealth(h);
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

  if (!ready) return gate;

  return (
    <>
      <PageHeader
        title="Platform overview"
        subtitle="Cross-tenant KPIs, module adoption & platform health"
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/super-admin/platform/institutions">
              <Button variant="secondary">Institutions</Button>
            </Link>
            <Button variant="secondary" onClick={load} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
        }
      />

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : kpis ? (
        <div className="space-y-8">
          {health && (
            <div>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Platform health
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <HealthChip label="PostgreSQL" ok={health.postgres} />
                <HealthChip label="MongoDB" ok={health.mongo} />
                <HealthChip label="Audit log" ok={health.auditLog} />
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                  Uptime{" "}
                  <span className="font-medium text-slate-900">
                    {formatUptime(health.uptimeSeconds)}
                  </span>
                </div>
                <Link
                  href="/super-admin/health"
                  className="text-sm font-medium text-brand-600 hover:text-brand-700"
                >
                  Details →
                </Link>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Institutions"
              value={formatNumber(kpis.totalInstitutions)}
              hint={`${formatNumber(kpis.activeInstitutions)} active · ${formatNumber(
                kpis.suspendedInstitutions
              )} suspended`}
            />
            <KpiCard label="Students" value={formatNumber(kpis.totalStudents)} />
            <KpiCard label="Staff" value={formatNumber(kpis.totalStaff)} />
            <KpiCard label="Users" value={formatNumber(kpis.totalUsers)} />
            <KpiCard
              label="Fees outstanding"
              value={formatNumber(kpis.feesOutstanding)}
            />
            <KpiCard
              label="Online payments"
              value={formatNumber(kpis.onlinePaymentsTotal)}
            />
            <KpiCard
              label="Documents"
              value={formatNumber(kpis.totalDocuments)}
              hint={`${formatBytes(kpis.storageBytes)} stored`}
            />
            <KpiCard
              label="Active sessions"
              value={formatNumber(kpis.activeSessions)}
            />
            <KpiCard
              label="Scheduled reports"
              value={formatNumber(kpis.scheduledReports)}
            />
            <KpiCard
              label="Custom reports"
              value={formatNumber(kpis.customReports)}
            />
            <KpiCard label="Storage" value={formatBytes(kpis.storageBytes)} />
          </div>

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
                  <p className="text-sm font-medium text-slate-500">
                    {field.label}
                  </p>
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
