"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { AdminInstitutionBrief, AuditLogResponse } from "@/types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

async function downloadFile(path: string, filename: string) {
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let m = res.statusText;
    try {
      const d = await res.json();
      if (typeof d.error === "string") m = d.error;
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(res.status, m);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function methodTone(method: string): "green" | "amber" | "red" | "slate" {
  switch (method.toUpperCase()) {
    case "POST":
      return "green";
    case "PATCH":
    case "PUT":
      return "amber";
    case "DELETE":
      return "red";
    default:
      return "slate";
  }
}

export default function AuditLogsPage() {
  const [institutions, setInstitutions] = useState<AdminInstitutionBrief[]>([]);

  // Filters.
  const [institutionId, setInstitutionId] = useState("");
  const [moduleText, setModuleText] = useState("");
  const [action, setAction] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [result, setResult] = useState<AuditLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AdminInstitutionBrief[]>("/admin/institutions")
      .then(setInstitutions)
      .catch(() => undefined);
  }, []);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (institutionId) params.set("institutionId", institutionId);
    if (moduleText.trim()) params.set("module", moduleText.trim());
    if (action) params.set("action", action);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }, [institutionId, moduleText, action, dateFrom, dateTo]);

  const load = useCallback(async (qs: string) => {
    setLoading(true);
    setError(null);
    try {
      setResult(await api.get<AuditLogResponse>(`/admin/audit-logs${qs}`));
    } catch (err) {
      setResult(null);
      setError(
        err instanceof ApiError ? err.message : "Failed to load audit logs"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load("");
  }, [load]);

  const onExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadFile(
        `/admin/audit-logs/export${queryString}`,
        "audit-logs.csv"
      );
    } catch (err) {
      setExportError(
        err instanceof ApiError ? err.message : "Failed to export CSV"
      );
    } finally {
      setExporting(false);
    }
  };

  const available = result?.available ?? true;

  return (
    <>
      <PageHeader
        title="Audit logs"
        subtitle="Global request audit trail across all tenants"
        action={
          <Button
            variant="secondary"
            onClick={onExport}
            disabled={exporting || !available}
          >
            {exporting ? "Exporting…" : "Download CSV"}
          </Button>
        }
      />

      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-60">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Institution
            </span>
            <Select
              value={institutionId}
              onChange={(e) => setInstitutionId(e.target.value)}
            >
              <option value="">All institutions</option>
              {institutions.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.name} ({inst.code})
                </option>
              ))}
            </Select>
          </div>
          <div className="w-44">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Module
            </span>
            <Input
              placeholder="e.g. students"
              value={moduleText}
              onChange={(e) => setModuleText(e.target.value)}
            />
          </div>
          <div className="w-40">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Action
            </span>
            <Select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">All actions</option>
              <option value="POST">POST</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </Select>
          </div>
          <div className="w-40">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              From
            </span>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="w-40">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              To
            </span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <Button onClick={() => load(queryString)} disabled={loading}>
            {loading ? "Loading…" : "Apply filters"}
          </Button>
        </div>
      </Card>

      <ErrorNote message={exportError} />
      <div className="mt-2">
        <ErrorNote message={error} />
      </div>

      {loading ? (
        <Spinner />
      ) : !available ? (
        <Card>
          <p className="text-sm text-slate-600">
            Audit logging requires MongoDB (not configured).
          </p>
        </Card>
      ) : result && result.rows.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3">Module</th>
                  <th className="px-4 py-3">Path</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={methodTone(row.method)}>{row.method}</Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.module ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {row.path}
                    </td>
                    <td className="px-4 py-3 capitalize text-slate-600">
                      {row.userRole?.replace("_", " ") ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.statusCode ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {row.ip ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-slate-500">
            {result.rows.length} {result.rows.length === 1 ? "entry" : "entries"}
          </p>
        </>
      ) : !error ? (
        <EmptyState message="No audit entries for these filters" />
      ) : null}
    </>
  );
}
