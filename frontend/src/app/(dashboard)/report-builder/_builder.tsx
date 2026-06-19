"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Select,
  Spinner,
} from "@/components/ui";
import type {
  CustomReport,
  CustomReportResult,
  ReportSource,
  SchoolClass,
} from "@/types";

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

interface FilterState {
  dateFrom: string;
  dateTo: string;
  classId: string;
  sectionId: string;
  status: string;
  category: string;
  search: string;
}

const EMPTY_FILTERS: FilterState = {
  dateFrom: "",
  dateTo: "",
  classId: "",
  sectionId: "",
  status: "",
  category: "",
  search: "",
};

/** Strip empty values so we only send meaningful filters to the API. */
function cleanFilters(filters: FilterState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value.trim()) out[key] = value.trim();
  }
  return out;
}

export default function ReportBuilderForm({
  existing,
}: {
  existing?: CustomReport;
}) {
  const router = useRouter();
  const { can, loading: permsLoading } = usePermissions();
  const canShare = can("custom_reports:share");

  const [sources, setSources] = useState<ReportSource[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Builder state.
  const [reportKey, setReportKey] = useState(existing?.reportKey ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [visibility, setVisibility] = useState<"private" | "shared">(
    existing?.visibility ?? "private"
  );
  const [filters, setFilters] = useState<FilterState>({
    ...EMPTY_FILTERS,
    ...(existing?.filters ?? {}),
  });

  // Preview / column discovery.
  const [preview, setPreview] = useState<CustomReportResult | null>(null);
  const [selectedColumns, setSelectedColumns] = useState<string[]>(
    existing?.columns ?? []
  );
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Save state.
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);

  // Load report sources + class list for the pickers.
  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      api.get<ReportSource[]>("/custom-reports/sources"),
      api.get<SchoolClass[]>("/classes").catch(() => [] as SchoolClass[]),
    ])
      .then(([sourceList, classList]) => {
        setSources(sourceList);
        setClasses(classList);
      })
      .catch((err) =>
        setLoadError(
          err instanceof ApiError ? err.message : "Failed to load report sources"
        )
      )
      .finally(() => setLoading(false));
  }, []);

  const sourcesByCategory = useMemo(() => {
    const grouped = new Map<string, ReportSource[]>();
    for (const source of sources) {
      const list = grouped.get(source.category) ?? [];
      list.push(source);
      grouped.set(source.category, list);
    }
    return Array.from(grouped.entries());
  }, [sources]);

  const selectedSource = useMemo(
    () => sources.find((source) => source.key === reportKey) ?? null,
    [sources, reportKey]
  );

  const sectionOptions = useMemo(() => {
    const cls = classes.find((c) => c.id === filters.classId);
    return cls?.sections ?? [];
  }, [classes, filters.classId]);

  const runPreview = useCallback(
    async (key: string, current: FilterState) => {
      if (!key) return;
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const result = await api.post<CustomReportResult>(
          "/custom-reports/preview",
          { reportKey: key, filters: cleanFilters(current) }
        );
        setPreview(result);
        // Default to all discovered columns unless we are editing and already
        // have a saved selection that still exists in the source.
        const available = result.columns.map((col) => col.key);
        setSelectedColumns((prev) => {
          const kept = prev.filter((c) => available.includes(c));
          return kept.length > 0 ? kept : available;
        });
      } catch (err) {
        setPreview(null);
        setPreviewError(
          err instanceof ApiError ? err.message : "Failed to preview report"
        );
      } finally {
        setPreviewLoading(false);
      }
    },
    []
  );

  // Auto-preview once when a source is chosen (or on initial edit load).
  useEffect(() => {
    if (reportKey && !preview && !previewLoading && !loading) {
      runPreview(reportKey, filters);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportKey, loading]);

  const onSelectSource = (key: string) => {
    setReportKey(key);
    setPreview(null);
    setPreviewError(null);
    setSelectedColumns([]);
    if (key) runPreview(key, filters);
  };

  const setFilter = (patch: Partial<FilterState>) =>
    setFilters((prev) => ({ ...prev, ...patch }));

  const toggleColumn = (key: string) =>
    setSelectedColumns((prev) =>
      prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]
    );

  const onSave = async () => {
    setSaveError(null);
    setShareNote(null);
    if (!reportKey) {
      setSaveError("Choose a report source");
      return;
    }
    if (!name.trim()) {
      setSaveError("Enter a report name");
      return;
    }
    const wantShared = visibility === "shared" && canShare;
    const body = {
      name: name.trim(),
      reportKey,
      columns: selectedColumns,
      filters: cleanFilters(filters),
      visibility: wantShared ? "shared" : "private",
    };
    setSaving(true);
    try {
      if (existing) {
        await api.patch<CustomReport>(`/custom-reports/${existing.id}`, body);
      } else {
        await api.post<CustomReport>("/custom-reports", body);
      }
      router.push("/report-builder");
    } catch (err) {
      // A shared save without permission returns 403 — keep it private and tell
      // the user, but don't lose their work.
      if (err instanceof ApiError && err.status === 403) {
        setVisibility("private");
        setShareNote("Sharing requires permission — saved as private instead.");
        try {
          const privateBody = { ...body, visibility: "private" as const };
          if (existing) {
            await api.patch<CustomReport>(
              `/custom-reports/${existing.id}`,
              privateBody
            );
          } else {
            await api.post<CustomReport>("/custom-reports", privateBody);
          }
          router.push("/report-builder");
          return;
        } catch (retryErr) {
          setSaveError(
            retryErr instanceof ApiError
              ? retryErr.message
              : "Failed to save report"
          );
        }
      } else {
        setSaveError(
          err instanceof ApiError ? err.message : "Failed to save report"
        );
      }
    } finally {
      setSaving(false);
    }
  };

  if (permsLoading || loading) return <Spinner />;
  if (loadError) return <ErrorNote message={loadError} />;

  return (
    <div className="space-y-6">
      {/* Step 1 — source */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          1. Report source
        </h2>
        <div className="max-w-md">
          <Field label="Source">
            <Select
              value={reportKey}
              onChange={(event) => onSelectSource(event.target.value)}
            >
              <option value="">— Choose a source —</option>
              {sourcesByCategory.map(([category, items]) => (
                <optgroup key={category} label={category}>
                  {items.map((source) => (
                    <option key={source.key} value={source.key}>
                      {source.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
        </div>
        {selectedSource && (
          <p className="mt-2 text-xs text-slate-400">
            Category: {selectedSource.category}
          </p>
        )}
      </Card>

      {reportKey && (
        <>
          {/* Step 2 — filters */}
          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              2. Filters
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Date from">
                <Input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(event) =>
                    setFilter({ dateFrom: event.target.value })
                  }
                />
              </Field>
              <Field label="Date to">
                <Input
                  type="date"
                  value={filters.dateTo}
                  onChange={(event) => setFilter({ dateTo: event.target.value })}
                />
              </Field>
              <Field label="Class">
                <Select
                  value={filters.classId}
                  onChange={(event) =>
                    setFilter({ classId: event.target.value, sectionId: "" })
                  }
                >
                  <option value="">All classes</option>
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Section">
                <Select
                  value={filters.sectionId}
                  onChange={(event) =>
                    setFilter({ sectionId: event.target.value })
                  }
                  disabled={!filters.classId}
                >
                  <option value="">All sections</option>
                  {sectionOptions.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Status">
                <Input
                  placeholder="e.g. active, paid…"
                  value={filters.status}
                  onChange={(event) => setFilter({ status: event.target.value })}
                />
              </Field>
              <Field label="Category">
                <Input
                  value={filters.category}
                  onChange={(event) =>
                    setFilter({ category: event.target.value })
                  }
                />
              </Field>
              <Field label="Search">
                <Input
                  placeholder="Free text…"
                  value={filters.search}
                  onChange={(event) => setFilter({ search: event.target.value })}
                />
              </Field>
            </div>
            <div className="mt-4">
              <Button
                variant="secondary"
                onClick={() => runPreview(reportKey, filters)}
                disabled={previewLoading}
              >
                {previewLoading ? "Previewing…" : "Preview"}
              </Button>
            </div>
          </Card>

          {/* Step 3 — columns + live preview */}
          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              3. Columns & preview
            </h2>
            <ErrorNote message={previewError} />
            {previewLoading ? (
              <Spinner />
            ) : preview ? (
              <>
                {preview.columns.length === 0 ? (
                  <EmptyState message="This source has no columns" />
                ) : (
                  <div className="mb-4 flex flex-wrap gap-3">
                    {preview.columns.map((col) => (
                      <label
                        key={col.key}
                        className="flex items-center gap-2 text-sm font-medium text-slate-700"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                          checked={selectedColumns.includes(col.key)}
                          onChange={() => toggleColumn(col.key)}
                        />
                        {col.label}
                      </label>
                    ))}
                  </div>
                )}

                {(() => {
                  const visibleColumns = preview.columns.filter((col) =>
                    selectedColumns.includes(col.key)
                  );
                  if (visibleColumns.length === 0) {
                    return (
                      <EmptyState message="Select at least one column to preview" />
                    );
                  }
                  if (preview.rows.length === 0) {
                    return <EmptyState message="No rows for these filters" />;
                  }
                  return (
                    <>
                      <div className="overflow-x-auto rounded-xl border border-slate-200">
                        <table className="w-full text-left text-sm">
                          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                            <tr>
                              {visibleColumns.map((col) => (
                                <th
                                  key={col.key}
                                  className="whitespace-nowrap px-4 py-3"
                                >
                                  {col.label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {preview.rows.slice(0, 50).map((row, rowIndex) => (
                              <tr key={rowIndex}>
                                {visibleColumns.map((col) => (
                                  <td
                                    key={col.key}
                                    className="whitespace-nowrap px-4 py-3 text-slate-600"
                                  >
                                    {renderCell(row[col.key])}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="mt-3 text-sm text-slate-500">
                        Showing {Math.min(preview.rows.length, 50)} of{" "}
                        {preview.rows.length}{" "}
                        {preview.rows.length === 1 ? "row" : "rows"}
                      </p>
                    </>
                  );
                })()}
              </>
            ) : (
              <EmptyState message="Preview to discover columns" />
            )}
          </Card>

          {/* Step 4 — save */}
          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              4. Save
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Report name">
                <Input
                  placeholder="e.g. Active students by class"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field label="Visibility">
                <Select
                  value={visibility}
                  onChange={(event) =>
                    setVisibility(event.target.value as "private" | "shared")
                  }
                >
                  <option value="private">Private</option>
                  {canShare && <option value="shared">Shared</option>}
                </Select>
              </Field>
            </div>
            {!canShare && (
              <p className="mt-2 text-xs text-slate-400">
                Sharing requires the share permission — this report will be
                private.
              </p>
            )}
            {shareNote && (
              <p className="mt-2 text-sm text-amber-700">{shareNote}</p>
            )}
            <div className="mt-3">
              <ErrorNote message={saveError} />
            </div>
            <div className="mt-4 flex gap-2">
              <Button onClick={onSave} disabled={saving}>
                {saving ? "Saving…" : existing ? "Save changes" : "Save report"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => router.push("/report-builder")}
              >
                Cancel
              </Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
