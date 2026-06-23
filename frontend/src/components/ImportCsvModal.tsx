"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, ErrorNote, Modal } from "@/components/ui";
import { parseCsv, toCsvTemplate } from "@/lib/csv";

export interface ImportColumn {
  key: string;
  label: string;
  required?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** API path that accepts { rows: [...] }, e.g. "/students/import". */
  endpoint: string;
  columns: ImportColumn[];
  /** Example values keyed by column key — used to build the template's sample row. */
  sample: Record<string, string>;
  /** Downloaded template filename, e.g. "students-template.csv". */
  templateName: string;
  /** Called after a successful import so the caller can refresh its list. */
  onImported: () => void;
}

export function ImportCsvModal({
  open,
  onClose,
  title,
  endpoint,
  columns,
  sample,
  templateName,
  onImported,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setRows([]);
    setFileName(null);
    setError(null);
    setResult(null);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const close = () => {
    reset();
    onClose();
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setResult(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const parsed = parseCsv(await file.text());
      const mapped = parsed.map((r) => {
        const o: Record<string, string> = {};
        for (const c of columns) {
          const v = r[c.key];
          if (v != null && v !== "") o[c.key] = v;
        }
        return o;
      });
      setRows(mapped);
      if (mapped.length === 0) {
        setError(
          "No data rows found. Make sure the header row matches the template."
        );
      }
    } catch {
      setError("Could not read the file.");
    }
  };

  const submit = async () => {
    if (rows.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ imported: number }>(endpoint, { rows });
      setResult(res.imported);
      onImported();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const csv = toCsvTemplate(
      columns.map((c) => c.key),
      sample
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = templateName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal title={title} open={open} onClose={close}>
      <div className="space-y-4">
        <div className="rounded-lg border border-line bg-surface-2 p-3 text-xs text-muted">
          <p className="mb-1 font-medium text-ink">How it works</p>
          <p>
            Upload a <code className="rounded bg-surface px-1">.csv</code> file with
            a header row. Columns:{" "}
            {columns.map((c) => (
              <code key={c.key} className="mx-0.5 rounded bg-surface px-1 py-0.5">
                {c.key}
                {c.required ? "*" : ""}
              </code>
            ))}{" "}
            (* = required). Extra columns are ignored.
          </p>
          <button
            type="button"
            onClick={downloadTemplate}
            className="mt-2 font-medium text-brand-600 hover:underline"
          >
            Download CSV template
          </button>
        </div>

        {result === null ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-700"
            />
            {fileName && rows.length > 0 && (
              <p className="text-sm text-muted">
                <span className="font-medium text-ink">{rows.length}</span> row
                {rows.length === 1 ? "" : "s"} ready to import from{" "}
                <span className="font-medium text-ink">{fileName}</span>.
              </p>
            )}
            <ErrorNote message={error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={busy || rows.length === 0}
                onClick={submit}
              >
                {busy ? "Importing…" : `Import ${rows.length || ""}`.trim()}
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              Imported {result} record{result === 1 ? "" : "s"} successfully.
            </p>
            <div className="flex justify-end">
              <Button type="button" onClick={close}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
