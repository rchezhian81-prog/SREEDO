"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "@/components/toast";
import { Icon } from "@/components/icons";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  cx,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";

/**
 * Tenant Data Import / Export Center (PR-T5).
 *
 * Drives the already-built `/dataio/*` backend: a catalog of importable /
 * exportable entities (pre-filtered by the server to what the caller may use),
 * a CSV import flow with a dry-run preview + guarded commit, a reason-gated
 * export flow for sensitive datasets, and a collapsible history of past import
 * batches with drill-down into per-row errors.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

/**
 * Authenticated file download. The bulk endpoints stream a file (not JSON), so
 * they can't go through `api.ts` (which parses `res.json()`); mirror the
 * reports-center helper — attach the bearer token from the auth store, fetch,
 * then trigger a blob download. `window.open` would 401 (no auth header).
 */
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

interface ImportColumnSpec {
  field: string;
  required?: boolean;
  note?: string;
}
interface ImportEntity {
  key: string;
  label: string;
  appliesTo: string;
  columns: ImportColumnSpec[];
}
interface ExportEntity {
  key: string;
  label: string;
  appliesTo: string;
  sensitive: boolean;
  headers: string[];
}
interface Catalog {
  imports: ImportEntity[];
  exports: ExportEntity[];
}

interface RowError {
  field: string;
  message: string;
}
interface PreviewRow {
  row: number;
  valid: boolean;
  errors: RowError[];
  data: Record<string, string>;
}
interface DryRunResult {
  batchId: string;
  entity: string;
  total: number;
  valid: number;
  invalid: number;
  rows: PreviewRow[];
}

type ImportStatus = "dry_run" | "committed" | "failed" | "cancelled";
interface ImportBatch {
  id: string;
  entity: string;
  sourceFilename: string | null;
  status: ImportStatus;
  totalRows: number;
  validRows: number;
  errorRows: number;
  importedRows: number;
  errorMessage: string | null;
  createdByEmail: string | null;
  createdAt: string;
}

const STATUS_TONE: Record<ImportStatus, "green" | "red" | "slate" | "amber"> = {
  committed: "green",
  failed: "red",
  dry_run: "slate",
  cancelled: "amber",
};
const STATUS_LABEL: Record<ImportStatus, string> = {
  committed: "Committed",
  failed: "Failed",
  dry_run: "Dry run",
  cancelled: "Cancelled",
};

function StatusBadge({ status }: { status: ImportStatus }) {
  return <Badge tone={STATUS_TONE[status] ?? "slate"}>{STATUS_LABEL[status] ?? status}</Badge>;
}

/** Compact one-line summary of a row's values, for context on valid rows. */
function summariseData(data: Record<string, string>): string {
  const parts = Object.entries(data)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}: ${v}`);
  const joined = parts.join(" · ");
  if (!joined) return "—";
  return joined.length > 120 ? `${joined.slice(0, 120)}…` : joined;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function tabClass(active: boolean) {
  return cx(
    "inline-flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition",
    active ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink"
  );
}

export default function DataIoPage() {
  // Catalog.
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<"import" | "export">("import");

  // Import flow.
  const [importKey, setImportKey] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [dryRunning, setDryRunning] = useState(false);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [templating, setTemplating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Export flow.
  const [exportKey, setExportKey] = useState("");
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [reason, setReason] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Import history.
  const [history, setHistory] = useState<ImportBatch[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Batch drill-down.
  const [detailBatch, setDetailBatch] = useState<ImportBatch | null>(null);
  const [detailRows, setDetailRows] = useState<PreviewRow[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadCatalog = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api
      .get<Catalog>("/dataio/entities")
      .then((data) => {
        setCatalog(data);
        // Land on whichever section the user actually has access to.
        if (data.imports.length === 0 && data.exports.length > 0) setTab("export");
        else setTab("import");
      })
      .catch((err) =>
        setLoadError(
          err instanceof ApiError ? err.message : "Failed to load import / export options"
        )
      )
      .finally(() => setLoading(false));
  }, []);

  const loadHistory = useCallback(() => {
    setHistoryLoading(true);
    setHistoryError(null);
    api
      .get<ImportBatch[]>("/dataio/imports")
      .then(setHistory)
      .catch((err) =>
        setHistoryError(
          err instanceof ApiError ? err.message : "Failed to load import history"
        )
      )
      .finally(() => setHistoryLoading(false));
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // History is about imports — only fetch it when the user can import.
  useEffect(() => {
    if (catalog && catalog.imports.length > 0) loadHistory();
  }, [catalog, loadHistory]);

  const selectedImport = useMemo(
    () => catalog?.imports.find((e) => e.key === importKey) ?? null,
    [catalog, importKey]
  );
  const selectedExport = useMemo(
    () => catalog?.exports.find((e) => e.key === exportKey) ?? null,
    [catalog, exportKey]
  );

  const entityLabel = useCallback(
    (key: string) => catalog?.imports.find((e) => e.key === key)?.label ?? key,
    [catalog]
  );

  const clearFile = useCallback(() => {
    setFileName(null);
    setCsvText(null);
    setDryRun(null);
    setDryRunError(null);
    setCommitError(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const runDryRun = useCallback(async (entity: string, csv: string, filename: string) => {
    setDryRunning(true);
    setDryRunError(null);
    setCommitError(null);
    try {
      const res = await api.post<DryRunResult>(`/dataio/import/${entity}/dry-run`, {
        csv,
        filename,
      });
      setDryRun(res);
    } catch (err) {
      setDryRun(null);
      setDryRunError(
        err instanceof ApiError ? err.message : "Could not validate the file."
      );
    } finally {
      setDryRunning(false);
    }
  }, []);

  const onFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedImport) return;
    setCommitError(null);
    setDryRunError(null);
    let text: string;
    try {
      text = await file.text();
    } catch {
      clearFile();
      setDryRunError("Could not read the file.");
      return;
    }
    setFileName(file.name);
    setCsvText(text);
    await runDryRun(selectedImport.key, text, file.name);
  };

  const onDownloadTemplate = async () => {
    if (!selectedImport) return;
    setTemplating(true);
    try {
      await downloadFile(
        `/dataio/import/${selectedImport.key}/template`,
        `${selectedImport.key}-template.csv`
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not download the template."
      );
    } finally {
      setTemplating(false);
    }
  };

  const canCommit =
    !!dryRun && dryRun.total > 0 && dryRun.invalid === 0 && !committing && !dryRunning;

  const doCommit = async () => {
    if (!selectedImport || !csvText) return;
    setCommitting(true);
    setCommitError(null);
    try {
      const res = await api.post<{ batchId: string; imported: number }>(
        `/dataio/import/${selectedImport.key}/commit`,
        { csv: csvText, filename: fileName ?? undefined }
      );
      toast.success(`Imported ${res.imported} row${res.imported === 1 ? "" : "s"}`);
      setConfirmOpen(false);
      clearFile();
      loadHistory();
    } catch (err) {
      // Keep the preview so the user can see what failed; surface the reason.
      const msg = err instanceof ApiError ? err.message : "Import failed.";
      setCommitError(msg);
      toast.error(msg);
      setConfirmOpen(false);
    } finally {
      setCommitting(false);
    }
  };

  const onExport = async () => {
    if (!selectedExport) return;
    setExportError(null);
    const trimmedReason = reason.trim();
    if (selectedExport.sensitive && trimmedReason.length < 3) {
      setExportError(
        "Please enter a reason (at least 3 characters) for this sensitive export."
      );
      return;
    }
    setExporting(true);
    try {
      const params = new URLSearchParams({ format });
      if (selectedExport.sensitive) params.set("reason", trimmedReason);
      await downloadFile(
        `/dataio/export/${selectedExport.key}?${params.toString()}`,
        `${selectedExport.key}.${format}`
      );
      toast.success("Export ready");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Export failed.";
      setExportError(msg);
      toast.error(msg);
    } finally {
      setExporting(false);
    }
  };

  const openDetail = async (batch: ImportBatch) => {
    setDetailBatch(batch);
    setDetailRows(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      setDetailRows(await api.get<PreviewRow[]>(`/dataio/imports/${batch.id}/rows`));
    } catch (err) {
      setDetailError(
        err instanceof ApiError ? err.message : "Failed to load row details."
      );
    } finally {
      setDetailLoading(false);
    }
  };
  const closeDetail = () => {
    setDetailBatch(null);
    setDetailRows(null);
    setDetailError(null);
  };

  const hasImports = (catalog?.imports.length ?? 0) > 0;
  const hasExports = (catalog?.exports.length ?? 0) > 0;
  const emptyCatalog = !!catalog && !hasImports && !hasExports;

  return (
    <>
      <PageHeader
        title="Import / Export"
        subtitle="Bulk-load and export your institution's data"
      />

      {loading ? (
        <Spinner />
      ) : loadError ? (
        <div className="space-y-3">
          <ErrorNote message={loadError} />
          <Button variant="secondary" onClick={loadCatalog}>
            Retry
          </Button>
        </div>
      ) : emptyCatalog || !catalog ? (
        <EmptyState message="You don't have import/export access." />
      ) : (
        <div className="space-y-6">
          <div className="inline-flex gap-1 rounded-xl border border-line bg-surface-2 p-1 text-sm">
            {hasImports && (
              <button
                type="button"
                className={tabClass(tab === "import")}
                onClick={() => setTab("import")}
              >
                <Icon name="package" className="h-4 w-4" />
                Import
              </button>
            )}
            {hasExports && (
              <button
                type="button"
                className={tabClass(tab === "export")}
                onClick={() => setTab("export")}
              >
                <Icon name="download" className="h-4 w-4" />
                Export
              </button>
            )}
          </div>

          {/* ---- Import ---- */}
          {tab === "import" &&
            (hasImports ? (
              <Card className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="What to import">
                    <Select
                      value={importKey}
                      onChange={(e) => {
                        setImportKey(e.target.value);
                        clearFile();
                      }}
                    >
                      <option value="">Select data type…</option>
                      {catalog.imports.map((e) => (
                        <option key={e.key} value={e.key}>
                          {e.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                {selectedImport && (
                  <>
                    <div className="rounded-xl border border-line bg-surface-2 p-4 text-sm">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-ink">
                          Columns for {selectedImport.label}
                        </p>
                        <button
                          type="button"
                          onClick={onDownloadTemplate}
                          disabled={templating}
                          className="inline-flex items-center gap-1.5 font-medium text-brand-600 transition hover:underline disabled:opacity-60 dark:text-brand-300"
                        >
                          <Icon name="fileDown" className="h-4 w-4" />
                          {templating ? "Preparing…" : "Download template"}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedImport.columns.map((c) => (
                          <span
                            key={c.field}
                            title={c.note}
                            className="inline-flex items-center gap-1 rounded-md bg-surface px-2 py-1 text-xs text-muted"
                          >
                            <code className="text-ink">{c.field}</code>
                            {c.required && <span className="text-red-500">*</span>}
                          </span>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-faint">
                        * required. Extra columns are ignored.
                      </p>
                    </div>

                    <div>
                      <label
                        htmlFor="dataio-file"
                        className="mb-1.5 block text-sm font-medium text-ink"
                      >
                        Upload CSV
                      </label>
                      <input
                        id="dataio-file"
                        ref={fileRef}
                        type="file"
                        accept=".csv,text/csv"
                        onChange={onFileChange}
                        className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-700"
                      />
                      {fileName && (
                        <p className="mt-1.5 text-xs text-muted">
                          Loaded <span className="font-medium text-ink">{fileName}</span>
                        </p>
                      )}
                    </div>

                    <ErrorNote message={dryRunError} />
                    <ErrorNote message={commitError} />

                    {dryRunning ? (
                      <Spinner />
                    ) : (
                      dryRun && (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="text-muted">
                              <span className="font-semibold text-ink">
                                {dryRun.total}
                              </span>{" "}
                              row{dryRun.total === 1 ? "" : "s"}:
                            </span>
                            <Badge tone="green">
                              <Icon name="check" className="h-3 w-3" />
                              {dryRun.valid} valid
                            </Badge>
                            <Badge tone={dryRun.invalid > 0 ? "red" : "slate"}>
                              {dryRun.invalid > 0 && (
                                <Icon name="alert" className="h-3 w-3" />
                              )}
                              {dryRun.invalid} with errors
                            </Badge>
                          </div>

                          {dryRun.rows.length > 0 ? (
                            <div className="max-h-[30rem] overflow-auto rounded-xl border border-line">
                              <table className="w-full text-left text-sm">
                                <thead className="sticky top-0 border-b border-line bg-surface-2 text-xs uppercase text-muted">
                                  <tr>
                                    <th className="w-16 px-4 py-3">Row</th>
                                    <th className="w-28 px-4 py-3">Status</th>
                                    <th className="px-4 py-3">Details</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-line">
                                  {dryRun.rows.map((r) => (
                                    <tr
                                      key={r.row}
                                      className={r.valid ? "" : "bg-red-500/5"}
                                    >
                                      <td className="px-4 py-3 align-top text-muted">
                                        {r.row}
                                      </td>
                                      <td className="px-4 py-3 align-top">
                                        {r.valid ? (
                                          <Badge tone="green">
                                            <Icon name="check" className="h-3 w-3" />
                                            Valid
                                          </Badge>
                                        ) : (
                                          <Badge tone="red">Error</Badge>
                                        )}
                                      </td>
                                      <td className="px-4 py-3 align-top">
                                        {r.valid ? (
                                          <span className="text-faint">
                                            {summariseData(r.data)}
                                          </span>
                                        ) : (
                                          <ul className="space-y-0.5">
                                            {r.errors.map((er, i) => (
                                              <li
                                                key={i}
                                                className="text-red-600 dark:text-red-400"
                                              >
                                                <span className="font-medium">
                                                  {er.field}
                                                </span>
                                                : {er.message}
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <EmptyState message="No data rows found in this file." />
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-xs text-faint">
                              {dryRun.invalid > 0
                                ? "Fix the errors above and re-upload to enable import."
                                : "All rows are valid and ready to import."}
                            </p>
                            <Button
                              onClick={() => setConfirmOpen(true)}
                              disabled={!canCommit}
                            >
                              <Icon name="check" className="h-4 w-4" />
                              {committing
                                ? "Importing…"
                                : `Import ${dryRun.valid} row${
                                    dryRun.valid === 1 ? "" : "s"
                                  }`}
                            </Button>
                          </div>
                        </div>
                      )
                    )}
                  </>
                )}
              </Card>
            ) : (
              <EmptyState message="You don't have import access." />
            ))}

          {/* ---- Export ---- */}
          {tab === "export" &&
            (hasExports ? (
              <Card className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="What to export">
                    <Select
                      value={exportKey}
                      onChange={(e) => {
                        setExportKey(e.target.value);
                        setReason("");
                        setExportError(null);
                      }}
                    >
                      <option value="">Select data type…</option>
                      {catalog.exports.map((e) => (
                        <option key={e.key} value={e.key}>
                          {e.label}
                          {e.sensitive ? " (sensitive)" : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Format">
                    <Select
                      value={format}
                      onChange={(e) => setFormat(e.target.value as "csv" | "xlsx")}
                    >
                      <option value="csv">CSV</option>
                      <option value="xlsx">Excel (XLSX)</option>
                    </Select>
                  </Field>
                </div>

                {selectedExport && (
                  <>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                      <span>
                        {selectedExport.headers.length} column
                        {selectedExport.headers.length === 1 ? "" : "s"}
                      </span>
                      {selectedExport.sensitive && (
                        <Badge tone="amber">
                          <Icon name="shieldAlert" className="h-3 w-3" />
                          Sensitive — logged
                        </Badge>
                      )}
                    </div>

                    {selectedExport.headers.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {selectedExport.headers.map((h) => (
                          <span
                            key={h}
                            className="rounded-md bg-surface-2 px-2 py-1 text-xs text-muted"
                          >
                            {h}
                          </span>
                        ))}
                      </div>
                    )}

                    {selectedExport.sensitive && (
                      <Field
                        label="Reason"
                        hint="Sensitive exports are logged with your name and this reason."
                      >
                        <Input
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="Why do you need this export?"
                        />
                      </Field>
                    )}

                    <ErrorNote message={exportError} />

                    <div className="flex justify-end">
                      <Button onClick={onExport} disabled={exporting}>
                        <Icon name="download" className="h-4 w-4" />
                        {exporting ? "Preparing…" : `Download ${format.toUpperCase()}`}
                      </Button>
                    </div>
                  </>
                )}
              </Card>
            ) : (
              <EmptyState message="You don't have export access." />
            ))}

          {/* ---- Import history ---- */}
          {hasImports && (
            <Card>
              <button
                type="button"
                onClick={() => setHistoryOpen((o) => !o)}
                className="flex w-full items-center justify-between gap-2 text-left"
                aria-expanded={historyOpen}
              >
                <span className="flex items-center gap-2">
                  <Icon name="history" className="h-5 w-5 text-muted" />
                  <span className="font-semibold text-ink">Import history</span>
                  {history.length > 0 && <Badge tone="slate">{history.length}</Badge>}
                </span>
                <Icon
                  name={historyOpen ? "chevronDown" : "chevronRight"}
                  className="h-5 w-5 text-faint"
                />
              </button>

              {historyOpen && (
                <div className="mt-4 space-y-3">
                  <div className="flex justify-end">
                    <Button
                      variant="secondary"
                      onClick={loadHistory}
                      disabled={historyLoading}
                    >
                      {historyLoading ? "Refreshing…" : "Refresh"}
                    </Button>
                  </div>

                  {historyLoading ? (
                    <Spinner />
                  ) : historyError ? (
                    <ErrorNote message={historyError} />
                  ) : history.length === 0 ? (
                    <EmptyState message="No imports yet." />
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-line">
                      <table className="w-full text-left text-sm">
                        <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                          <tr>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3">Type</th>
                            <th className="px-4 py-3">Rows</th>
                            <th className="px-4 py-3">By</th>
                            <th className="px-4 py-3">When</th>
                            <th className="px-4 py-3" aria-label="Open" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {history.map((b) => (
                            <tr
                              key={b.id}
                              onClick={() => openDetail(b)}
                              className="cursor-pointer transition hover:bg-hover"
                            >
                              <td className="px-4 py-3">
                                <StatusBadge status={b.status} />
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-ink">
                                {entityLabel(b.entity)}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-muted">
                                {b.status === "committed"
                                  ? `${b.importedRows} imported`
                                  : `${b.validRows}/${b.totalRows} valid`}
                                {b.errorRows > 0 && (
                                  <span className="text-red-500">
                                    {" "}
                                    · {b.errorRows} error{b.errorRows === 1 ? "" : "s"}
                                  </span>
                                )}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-muted">
                                {b.createdByEmail ?? "—"}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-muted">
                                {formatWhen(b.createdAt)}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <Icon
                                  name="chevronRight"
                                  className="ml-auto h-4 w-4 text-faint"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Confirm import"
        tone="primary"
        confirmLabel="Import"
        busy={committing}
        message={
          selectedImport && dryRun
            ? `Import ${dryRun.valid} row${dryRun.valid === 1 ? "" : "s"} into ${
                selectedImport.label
              }? This cannot be undone.`
            : ""
        }
        onConfirm={doCommit}
        onClose={() => {
          if (!committing) setConfirmOpen(false);
        }}
      />

      <Modal
        title={detailBatch ? `Import — ${entityLabel(detailBatch.entity)}` : ""}
        open={!!detailBatch}
        onClose={closeDetail}
      >
        {detailBatch && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge status={detailBatch.status} />
              <span className="text-muted">
                {detailBatch.totalRows} rows · {detailBatch.validRows} valid ·{" "}
                {detailBatch.errorRows} error{detailBatch.errorRows === 1 ? "" : "s"}
              </span>
            </div>
            {detailBatch.sourceFilename && (
              <p className="text-xs text-faint">File: {detailBatch.sourceFilename}</p>
            )}
            {detailBatch.errorMessage && (
              <ErrorNote message={detailBatch.errorMessage} />
            )}

            {detailLoading ? (
              <Spinner />
            ) : detailError ? (
              <ErrorNote message={detailError} />
            ) : detailRows && detailRows.length > 0 ? (
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {detailRows.map((r) => (
                  <div key={r.row} className="rounded-lg border border-line p-3">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-xs font-semibold text-muted">
                        Row {r.row}
                      </span>
                      {r.valid ? (
                        <Badge tone="green">Valid</Badge>
                      ) : (
                        <Badge tone="red">Error</Badge>
                      )}
                    </div>
                    {r.valid ? (
                      <p className="text-xs text-faint">{summariseData(r.data)}</p>
                    ) : (
                      <ul className="space-y-0.5 text-xs">
                        {r.errors.map((er, i) => (
                          <li key={i} className="text-red-600 dark:text-red-400">
                            <span className="font-medium">{er.field}</span>: {er.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="No row details available." />
            )}

            <div className="flex justify-end">
              <Button variant="secondary" onClick={closeDetail}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
