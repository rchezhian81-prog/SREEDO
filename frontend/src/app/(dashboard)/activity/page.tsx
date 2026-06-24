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
import type { AuditLogResponse } from "@/types";

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

export default function ActivityLogPage() {
  const [moduleText, setModuleText] = useState("");
  const [action, setAction] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [result, setResult] = useState<AuditLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (moduleText.trim()) params.set("module", moduleText.trim());
    if (action) params.set("action", action);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }, [moduleText, action, dateFrom, dateTo]);

  const load = useCallback(async (qs: string) => {
    setLoading(true);
    setError(null);
    try {
      setResult(await api.get<AuditLogResponse>(`/activity${qs}`));
    } catch (err) {
      setResult(null);
      setError(
        err instanceof ApiError ? err.message : "Failed to load activity log"
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
      await downloadFile(`/activity/export${queryString}`, "activity-log.csv");
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
        title="Activity log"
        subtitle="Who changed what in your institution"
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
          <div className="w-44">
            <span className="mb-1 block text-sm font-medium text-muted">
              Module
            </span>
            <Input
              placeholder="e.g. students"
              value={moduleText}
              onChange={(e) => setModuleText(e.target.value)}
            />
          </div>
          <div className="w-44">
            <span className="mb-1 block text-sm font-medium text-muted">
              Action
            </span>
            <Select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">All actions</option>
              <option value="POST">Created (POST)</option>
              <option value="PATCH">Updated (PATCH)</option>
              <option value="PUT">Updated (PUT)</option>
              <option value="DELETE">Deleted (DELETE)</option>
            </Select>
          </div>
          <div className="w-40">
            <span className="mb-1 block text-sm font-medium text-muted">From</span>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="w-40">
            <span className="mb-1 block text-sm font-medium text-muted">To</span>
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
          <p className="text-sm text-muted">
            Activity logging requires MongoDB (not configured).
          </p>
        </Card>
      ) : result && result.rows.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Module</th>
                  <th className="px-4 py-3">Path</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {result.rows.map((row) => (
                  <tr key={row.id} className="hover:bg-hover">
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={methodTone(row.method)}>{row.method}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted">{row.module ?? "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">
                      {row.path}
                    </td>
                    <td className="px-4 py-3 capitalize text-muted">
                      {row.userRole?.replace("_", " ") ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {row.statusCode ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-faint">
                      {row.ip ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-muted">
            {result.rows.length}{" "}
            {result.rows.length === 1 ? "entry" : "entries"}
          </p>
        </>
      ) : !error ? (
        <EmptyState message="No activity for these filters" />
      ) : null}
    </>
  );
}
