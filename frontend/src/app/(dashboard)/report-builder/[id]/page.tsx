"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { usePermissions } from "@/lib/use-permissions";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { CustomReport, CustomReportResult } from "@/types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

async function downloadFile(path: string, filename: string) {
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      if (typeof data.error === "string") message = data.error;
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(res.status, message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function ReportRunPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { can, loading: permsLoading } = usePermissions();
  const canExport = can("custom_reports:export");

  const [definition, setDefinition] = useState<CustomReport | null>(null);
  const [result, setResult] = useState<CustomReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setRunError(null);
    try {
      const def = await api.get<CustomReport>(`/custom-reports/${id}`);
      setDefinition(def);
      try {
        setResult(await api.get<CustomReportResult>(`/custom-reports/${id}/run`));
      } catch (err) {
        setResult(null);
        if (err instanceof ApiError && err.status === 403) {
          setRunError(
            "You don't have permission to view the data behind this report."
          );
        } else {
          setRunError(
            err instanceof ApiError ? err.message : "Failed to run report"
          );
        }
      }
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load report"
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const onExport = async (format: "csv" | "pdf") => {
    if (!definition) return;
    setExporting(format);
    setExportError(null);
    try {
      await downloadFile(
        `/custom-reports/${id}/export?format=${format}`,
        `${definition.name}.${format}`
      );
    } catch (err) {
      setExportError(
        err instanceof ApiError
          ? err.message
          : `Failed to export ${format.toUpperCase()}`
      );
    } finally {
      setExporting(null);
    }
  };

  if (permsLoading || loading) {
    return (
      <>
        <PageHeader title="Report" subtitle="Run a saved report" />
        <Spinner />
      </>
    );
  }

  if (!can("custom_reports:read")) {
    return (
      <>
        <PageHeader title="Report" subtitle="Run a saved report" />
        <EmptyState message="You don't have access to the report builder." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={definition?.name ?? "Report"}
        subtitle={result?.title ?? "Run a saved report"}
        action={
          canExport && definition ? (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => onExport("csv")}
                disabled={exporting !== null}
              >
                {exporting === "csv" ? "Exporting…" : "Export CSV"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => onExport("pdf")}
                disabled={exporting !== null}
              >
                {exporting === "pdf" ? "Exporting…" : "Export PDF"}
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Link
          href="/report-builder"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Report Builder
        </Link>
      </div>

      {loadError ? (
        <ErrorNote message={loadError} />
      ) : (
        <Card>
          {definition && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge
                tone={definition.visibility === "shared" ? "blue" : "slate"}
              >
                {definition.visibility}
              </Badge>
            </div>
          )}

          <div className="space-y-2">
            <ErrorNote message={exportError} />
            <ErrorNote message={runError} />
          </div>

          {result && result.rows.length > 0 ? (
            <>
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                    <tr>
                      {result.columns.map((col) => (
                        <th
                          key={col.key}
                          className="whitespace-nowrap px-4 py-3"
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {result.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {result.columns.map((col) => (
                          <td
                            key={col.key}
                            className="whitespace-nowrap px-4 py-3 text-muted"
                          >
                            {renderCell(row[col.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-sm text-muted">
                {result.rows.length}{" "}
                {result.rows.length === 1 ? "row" : "rows"}
              </p>
            </>
          ) : result && !runError ? (
            <EmptyState message="No rows for this report" />
          ) : null}
        </Card>
      )}
    </>
  );
}
