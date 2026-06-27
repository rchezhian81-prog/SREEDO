"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type {
  AdminInstitutionBrief,
  InstitutionStats,
  SystemHealth,
} from "@/types";

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

function StatusCard({
  label,
  ok,
}: {
  label: string;
  ok: boolean;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-600">{label}</span>
        <Badge tone={ok ? "green" : "red"}>{ok ? "online" : "offline"}</Badge>
      </div>
    </Card>
  );
}

function CountCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <Card>
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </Card>
  );
}

const STAT_FIELDS: { key: keyof InstitutionStats; label: string }[] = [
  { key: "students", label: "Students" },
  { key: "teachers", label: "Teachers" },
  { key: "classes", label: "Classes" },
  { key: "sections", label: "Sections" },
  { key: "subjects", label: "Subjects" },
  { key: "users", label: "Users" },
];

export default function SystemHealthPage() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [institutions, setInstitutions] = useState<AdminInstitutionBrief[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [stats, setStats] = useState<InstitutionStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  const loadHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setHealth(await api.get<SystemHealth>("/admin/system/health"));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load system health"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHealth();
    api
      .get<AdminInstitutionBrief[]>("/admin/institutions")
      .then(setInstitutions)
      .catch(() => undefined);
  }, [loadHealth]);

  const onSelectTenant = async (id: string) => {
    setSelectedId(id);
    setStats(null);
    setStatsError(null);
    if (!id) return;
    setStatsLoading(true);
    try {
      setStats(
        await api.get<InstitutionStats>(`/admin/institutions/${id}/stats`)
      );
    } catch (err) {
      setStatsError(
        err instanceof ApiError ? err.message : "Failed to load tenant stats"
      );
    } finally {
      setStatsLoading(false);
    }
  };

  const selectedInstitution = institutions.find((i) => i.id === selectedId);

  return (
    <>
      <PageHeader
        title="System health"
        subtitle="Platform status, datastore health & cross-tenant snapshot"
        action={
          <Button variant="secondary" onClick={loadHealth} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : health ? (
        <div className="space-y-3">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatusCard label="PostgreSQL" ok={health.postgres} />
            <StatusCard label="MongoDB" ok={health.mongo} />
            <StatusCard label="Audit log" ok={health.auditLog} />
            <CountCard label="Institutions" value={health.institutions} />
            <CountCard label="Users" value={health.users} />
            <CountCard
              label="Uptime"
              value={formatUptime(health.uptimeSeconds)}
            />
          </div>
        </div>
      ) : null}

      <div className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">
          Cross-tenant snapshot
        </h2>
        <Card className="mb-4">
          <div className="w-full max-w-md">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              View institution (read-only)
            </span>
            <Select
              value={selectedId}
              onChange={(e) => onSelectTenant(e.target.value)}
            >
              <option value="">Select an institution…</option>
              {institutions.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.name} ({inst.code})
                </option>
              ))}
            </Select>
          </div>
        </Card>

        {selectedId && (
          <Card className="border-amber-300 bg-amber-50">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-amber-800">
                Viewing {selectedInstitution?.name ?? "institution"} — read-only
              </p>
              <Badge tone="amber">read-only</Badge>
            </div>

            {statsLoading ? (
              <Spinner />
            ) : statsError ? (
              <ErrorNote message={statsError} />
            ) : stats ? (
              <>
                <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {STAT_FIELDS.map((field) => (
                    <div
                      key={field.key}
                      className="rounded-lg border border-amber-200 bg-white px-4 py-3"
                    >
                      <p className="text-xs font-medium text-slate-500">
                        {field.label}
                      </p>
                      <p className="mt-1 text-xl font-semibold text-slate-900">
                        {Number(stats[field.key]).toLocaleString()}
                      </p>
                    </div>
                  ))}
                  <div className="rounded-lg border border-amber-200 bg-white px-4 py-3">
                    <p className="text-xs font-medium text-slate-500">
                      Fees outstanding
                    </p>
                    <p className="mt-1 text-xl font-semibold text-slate-900">
                      {Number(stats.feesOutstanding).toLocaleString()}
                    </p>
                  </div>
                </div>
              </>
            ) : null}
          </Card>
        )}
      </div>
    </>
  );
}
