"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { usePermissions } from "@/lib/use-permissions";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { CustomReport, ReportSource } from "@/types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

/** Download a Bearer-authenticated file (CSV text / PDF binary) as a blob. */
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

export default function ReportBuilderHubPage() {
  const router = useRouter();
  const { can, loading: permsLoading } = usePermissions();
  const canCreate = can("custom_reports:create");
  const canUpdate = can("custom_reports:update");
  const canDelete = can("custom_reports:delete");
  const canExport = can("custom_reports:export");
  const canRun = can("custom_reports:run");

  const [reports, setReports] = useState<CustomReport[]>([]);
  const [sources, setSources] = useState<ReportSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CustomReport | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [defs, sourceList] = await Promise.all([
        api.get<CustomReport[]>("/custom-reports"),
        api
          .get<ReportSource[]>("/custom-reports/sources")
          .catch((err) => {
            console.error("Failed to load report sources", err);
            return [] as ReportSource[];
          }),
      ]);
      setReports(defs);
      setSources(sourceList);
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load reports"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!permsLoading && can("custom_reports:read")) load();
    else if (!permsLoading) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permsLoading]);

  const sourceTitle = useMemo(() => {
    const map = new Map(sources.map((s) => [s.key, s.title]));
    return (key: string) => map.get(key) ?? key;
  }, [sources]);

  const onDuplicate = async (report: CustomReport) => {
    setActionError(null);
    setBusyId(report.id);
    try {
      await api.post<CustomReport>(`/custom-reports/${report.id}/duplicate`);
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to duplicate report"
      );
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = (report: CustomReport) => {
    setDeleting(report);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setActionError(null);
    setBusyId(deleting.id);
    try {
      await api.delete(`/custom-reports/${deleting.id}`);
      setDeleting(null);
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to delete report"
      );
    } finally {
      setBusyId(null);
    }
  };

  const onExport = async (report: CustomReport, format: "csv" | "pdf") => {
    setActionError(null);
    setBusyId(report.id);
    try {
      await downloadFile(
        `/custom-reports/${report.id}/export?format=${format}`,
        `${report.name}.${format}`
      );
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : `Failed to export ${format.toUpperCase()}`
      );
    } finally {
      setBusyId(null);
    }
  };

  if (permsLoading || loading) {
    return (
      <>
        <PageHeader title="Report Builder" subtitle="Build & save custom reports" />
        <Spinner />
      </>
    );
  }

  if (!can("custom_reports:read")) {
    return (
      <>
        <PageHeader title="Report Builder" subtitle="Build & save custom reports" />
        <EmptyState message="You don't have access to the report builder." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Report Builder"
        subtitle="Build & save custom reports"
        action={
          canCreate ? (
            <Link href="/report-builder/new">
              <Button>+ New report</Button>
            </Link>
          ) : undefined
        }
      />

      {loadError ? (
        <ErrorNote message={loadError} />
      ) : (
        <div className="space-y-4">
          <ErrorNote message={actionError} />
          {reports.length === 0 ? (
            <EmptyState message="No saved reports yet. Create one to get started." />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Visibility</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {reports.map((report) => (
                    <tr key={report.id} className="hover:bg-hover">
                      <td className="px-4 py-3 font-medium text-ink">
                        {report.name}
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {sourceTitle(report.reportKey)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          tone={
                            report.visibility === "shared" ? "blue" : "slate"
                          }
                        >
                          {report.visibility}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-3">
                          {canRun && (
                            <Link
                              href={`/report-builder/${report.id}`}
                              className="text-xs font-medium text-brand-600 hover:text-brand-700"
                            >
                              Run
                            </Link>
                          )}
                          {canUpdate && (
                            <button
                              onClick={() =>
                                router.push(`/report-builder/${report.id}/edit`)
                              }
                              className="text-xs font-medium text-brand-600 hover:text-brand-700"
                            >
                              Edit
                            </button>
                          )}
                          {canCreate && (
                            <button
                              onClick={() => onDuplicate(report)}
                              disabled={busyId === report.id}
                              className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
                            >
                              Duplicate
                            </button>
                          )}
                          {canExport && (
                            <>
                              <button
                                onClick={() => onExport(report, "csv")}
                                disabled={busyId === report.id}
                                className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
                              >
                                CSV
                              </button>
                              <button
                                onClick={() => onExport(report, "pdf")}
                                disabled={busyId === report.id}
                                className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
                              >
                                PDF
                              </button>
                            </>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => onDelete(report)}
                              disabled={busyId === report.id}
                              className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete report"
        message={deleting ? `Delete report "${deleting.name}"?` : ""}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        tone="danger"
        busy={deleting !== null && busyId === deleting.id}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
