"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
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
import type { PlatformAuditEntry, PlatformInstitution } from "@/types";
import { usePlatformGuard } from "../_guard";
import { compactDetail } from "../_utils";

export default function PlatformAuditPage() {
  const { ready, gate } = usePlatformGuard(
    "Platform audit",
    "Durable cross-tenant administrative trail"
  );

  const [institutions, setInstitutions] = useState<PlatformInstitution[]>([]);

  // Filters.
  const [institutionId, setInstitutionId] = useState("");
  const [action, setAction] = useState("");
  const [targetType, setTargetType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [rows, setRows] = useState<PlatformAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    api
      .get<PlatformInstitution[]>("/platform/institutions")
      .then(setInstitutions)
      .catch(() => undefined);
  }, [ready]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (institutionId) params.set("institutionId", institutionId);
    if (action.trim()) params.set("action", action.trim());
    if (targetType.trim()) params.set("targetType", targetType.trim());
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    params.set("limit", "200");
    return `?${params.toString()}`;
  }, [institutionId, action, targetType, dateFrom, dateTo]);

  const load = useCallback(async (qs: string) => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api.get<PlatformAuditEntry[]>(`/platform/audit${qs}`));
    } catch (err) {
      setRows([]);
      setError(
        err instanceof ApiError ? err.message : "Failed to load audit trail"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) load("?limit=200");
  }, [ready, load]);

  if (!ready) return gate;

  return (
    <>
      <PageHeader
        title="Platform audit"
        subtitle="Durable cross-tenant administrative trail"
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
              Action
            </span>
            <Input
              placeholder="e.g. suspend"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            />
          </div>
          <div className="w-44">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Target type
            </span>
            <Input
              placeholder="e.g. institution"
              value={targetType}
              onChange={(e) => setTargetType(e.target.value)}
            />
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

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        !error ? (
          <EmptyState message="No audit entries for these filters." />
        ) : null
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">IP</th>
                  <th className="px-4 py-3">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id} className="align-top hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone="blue">{row.action}</Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.targetType ?? "—"}
                      {row.targetId && (
                        <span className="block font-mono text-xs text-slate-400">
                          {row.targetId}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.actorEmail ?? "—"}
                    </td>
                    <td className="px-4 py-3 capitalize text-slate-600">
                      {row.actorRole?.replace("_", " ") ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {row.ip ?? "—"}
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      <span className="block truncate font-mono text-xs text-slate-500">
                        {compactDetail(row.detail)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-slate-500">
            {rows.length} {rows.length === 1 ? "entry" : "entries"}
          </p>
        </>
      )}
    </>
  );
}
