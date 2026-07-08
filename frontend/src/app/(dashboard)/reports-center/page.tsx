"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useTerms } from "@/lib/terms";
import { useAuthStore } from "@/stores/auth-store";
import {
  Button,
  Card,
  cx,
  EmptyState,
  ErrorNote,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { Exam, ReportData, ReportMeta, SchoolClass } from "@/types";
import { useI18n } from "@/i18n/I18nProvider";

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

interface SectionOption {
  id: string;
  label: string;
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function ReportsCenterPage() {
  const { t } = useI18n();
  const term = useTerms();
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [role, setRole] = useState("");
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Filter state.
  const [sectionId, setSectionId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [examId, setExamId] = useState("");

  // Data fetch state.
  const [data, setData] = useState<ReportData | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  // Export state.
  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      api.get<ReportMeta[]>("/report-center"),
      api.get<{ role: string; permissions: string[] }>("/auth/permissions"),
      api.get<SchoolClass[]>("/classes").catch((err) => {
        console.error("Failed to load classes", err);
        return [] as SchoolClass[];
      }),
      api.get<Exam[]>("/exams").catch((err) => {
        console.error("Failed to load exams", err);
        return [] as Exam[];
      }),
    ])
      .then(([reportList, perms, classes, examList]) => {
        setReports(reportList);
        setPermissions(perms.permissions);
        setRole(perms.role);
        setSections(
          classes.flatMap((schoolClass) =>
            schoolClass.sections.map((section) => ({
              id: section.id,
              label: `${schoolClass.name} - ${section.name}`,
            }))
          )
        );
        setExams(examList);
      })
      .catch((err) =>
        setLoadError(
          err instanceof ApiError ? err.message : "Failed to load reports"
        )
      )
      .finally(() => setLoading(false));
  }, []);

  // Only show reports the user is allowed to run; super_admin sees everything.
  const visibleReports = useMemo(() => {
    if (role === "super_admin") return reports;
    return reports.filter((report) => permissions.includes(report.permission));
  }, [reports, permissions, role]);

  const categories = useMemo(() => {
    const grouped = new Map<string, ReportMeta[]>();
    for (const report of visibleReports) {
      const list = grouped.get(report.category) ?? [];
      list.push(report);
      grouped.set(report.category, list);
    }
    return Array.from(grouped.entries());
  }, [visibleReports]);

  const selectedReport = useMemo(
    () => visibleReports.find((report) => report.key === selectedKey) ?? null,
    [visibleReports, selectedKey]
  );

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (sectionId) params.set("sectionId", sectionId);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (examId) params.set("examId", examId);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }, [sectionId, dateFrom, dateTo, examId]);

  const runReport = useCallback(
    async (key: string, qs: string) => {
      setDataLoading(true);
      setDataError(null);
      try {
        setData(await api.get<ReportData>(`/report-center/${key}${qs}`));
      } catch (err) {
        setData(null);
        setDataError(
          err instanceof ApiError ? err.message : "Failed to load report"
        );
      } finally {
        setDataLoading(false);
      }
    },
    []
  );

  const selectReport = (key: string) => {
    setSelectedKey(key);
    setData(null);
    setDataError(null);
    setExportError(null);
    runReport(key, queryString);
  };

  const onExport = async (format: "csv" | "pdf") => {
    if (!selectedKey) return;
    setExporting(format);
    setExportError(null);
    try {
      await downloadFile(
        `/report-center/${selectedKey}/export?format=${format}${
          queryString ? `&${queryString.slice(1)}` : ""
        }`,
        `${selectedKey}.${format}`
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

  return (
    <>
      <PageHeader
        title={t("pages.reportsCenter.title")}
        subtitle={t("pages.reportsCenter.subtitle")}
      />

      {loading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorNote message={loadError} />
      ) : (
        <div className="space-y-6">
          {categories.length === 0 ? (
            <EmptyState message="No reports available for your role" />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {categories.map(([category, items]) => (
                <Card key={category}>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
                    {category}
                  </h2>
                  <div className="space-y-2">
                    {items.map((report) => (
                      <button
                        key={report.key}
                        onClick={() => selectReport(report.key)}
                        className={cx(
                          "w-full rounded-lg border px-3 py-2 text-left text-sm font-medium transition",
                          report.key === selectedKey
                            ? "border-brand-500 bg-brand-50 text-brand-700"
                            : "border-line text-muted hover:bg-hover"
                        )}
                      >
                        {report.title}
                      </button>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {selectedReport && (
            <Card>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-ink">
                  {selectedReport.title}
                </h2>
                <div className="flex flex-wrap gap-2">
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
              </div>

              <div className="mb-4 flex flex-wrap items-end gap-3">
                <div className="w-56">
                  <span className="mb-1 block text-sm font-medium text-muted">
                    {term.section}
                  </span>
                  <Select
                    value={sectionId}
                    onChange={(event) => setSectionId(event.target.value)}
                  >
                    <option value="">{`All ${term.sectionPlural.toLowerCase()}`}</option>
                    {sections.map((section) => (
                      <option key={section.id} value={section.id}>
                        {section.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="w-44">
                  <span className="mb-1 block text-sm font-medium text-muted">
                    From
                  </span>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(event) => setDateFrom(event.target.value)}
                  />
                </div>
                <div className="w-44">
                  <span className="mb-1 block text-sm font-medium text-muted">
                    To
                  </span>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(event) => setDateTo(event.target.value)}
                  />
                </div>
                <div className="w-56">
                  <span className="mb-1 block text-sm font-medium text-muted">
                    Exam
                  </span>
                  <Select
                    value={examId}
                    onChange={(event) => setExamId(event.target.value)}
                  >
                    <option value="">All exams</option>
                    {exams.map((exam) => (
                      <option key={exam.id} value={exam.id}>
                        {exam.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button
                  onClick={() => runReport(selectedReport.key, queryString)}
                  disabled={dataLoading}
                >
                  {dataLoading ? "Running…" : "Run / Refresh"}
                </Button>
              </div>

              <div className="space-y-2">
                <ErrorNote message={exportError} />
                <ErrorNote message={dataError} />
              </div>

              {dataLoading ? (
                <Spinner />
              ) : data && data.rows.length > 0 ? (
                <>
                  <div className="overflow-x-auto rounded-xl border border-line">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                        <tr>
                          {data.columns.map((col) => (
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
                        {data.rows.map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {data.columns.map((col) => (
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
                    {data.rows.length}{" "}
                    {data.rows.length === 1 ? "row" : "rows"}
                  </p>
                </>
              ) : !dataError ? (
                <EmptyState message="No rows for these filters" />
              ) : null}
            </Card>
          )}
        </div>
      )}
    </>
  );
}
