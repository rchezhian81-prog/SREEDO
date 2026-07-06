"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type { OpsLogsSummary } from "@/types";
import { downloadFile, errorStatusTone, formatDateTime, formatExt, statusClassTone, titleCase } from "./taxonomy";
import { formatNumber } from "../../platform/_utils";

type Source = "all" | "errors" | "audit";
const SOURCES: Source[] = ["all", "errors", "audit"];

export function LogsTab({ reloadKey }: { reloadKey: number }) {
  const [source, setSource] = useState<Source>("all");
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [data, setData] = useState<OpsLogsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setApplied(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("source", source);
    if (applied.trim()) p.set("q", applied.trim());
    return p.toString();
  }, [source, applied]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<OpsLogsSummary>(`/observability/logs?${query}`));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const showErrors = source === "all" || source === "errors";
  const showAudit = source === "all" || source === "audit";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Logs</h2>
        <Button variant="secondary" onClick={() => setExportOpen(true)}>
          <Icon name="download" className="h-4 w-4" />
          Export
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Select value={source} onChange={(e) => setSource(e.target.value as Source)} aria-label="Source">
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </Select>
        <Input
          placeholder="Search route / action / actor…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search"
        />
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : data ? (
        <div className="space-y-5">
          {showErrors && (
            <Card className="p-0">
              <div className="border-b border-line px-5 py-3">
                <p className="text-sm font-semibold text-ink">Error events</p>
              </div>
              {data.errors.length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted">No error events.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {data.errors.map((e) => (
                    <li key={e.id} className="px-5 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <Badge tone={statusClassTone(`${Math.floor(e.statusCode / 100)}xx`)}>
                            {e.statusCode}
                          </Badge>
                          <span className="truncate font-mono text-xs text-ink">
                            {e.method} {e.route}
                          </span>
                          <Badge tone={errorStatusTone(e.status)}>{titleCase(e.status)}</Badge>
                        </div>
                        <span className="text-xs text-faint">
                          ×{formatNumber(e.count)} · {formatDateTime(e.lastSeen)}
                        </span>
                      </div>
                      {e.message && <p className="mt-1 truncate text-xs text-muted">{e.message}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {showAudit && (
            <Card className="p-0">
              <div className="border-b border-line px-5 py-3">
                <p className="text-sm font-semibold text-ink">Audit events</p>
              </div>
              {data.audit.length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted">No audit events.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {data.audit.map((a) => (
                    <li
                      key={a.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge tone="blue">{a.action}</Badge>
                        <span className="truncate text-muted">{a.actorEmail ?? "system"}</span>
                        {a.actorRole && <span className="text-xs text-faint">{a.actorRole}</span>}
                        {a.targetType && <span className="text-xs text-faint">· {a.targetType}</span>}
                      </div>
                      <span className="text-xs text-faint">
                        {a.ip ? `${a.ip} · ` : ""}
                        {formatDateTime(a.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      ) : (
        !error && <EmptyState message="No logs available." />
      )}

      <LogExportModal open={exportOpen} source={source} onClose={() => setExportOpen(false)} />
    </div>
  );
}

const MIN_REASON = 5;

function LogExportModal({
  open,
  source,
  onClose,
}: {
  open: boolean;
  source: Source;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFormat("csv");
      setReason("");
      setBusy(false);
      setError(null);
    }
  }, [open]);

  const reasonLen = reason.trim().length;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      p.set("format", format);
      p.set("reason", reason.trim());
      p.set("source", source);
      await downloadFile(
        `/observability/logs/export?${p.toString()}`,
        `observability-logs.${formatExt(format)}`
      );
      toast.success("Log export downloaded.");
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Export logs" open={open} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Exporting a broad, masked log is audited. A reason is required and recorded in the platform
          audit log. The current source ({titleCase(source)}) is applied.
        </div>
        <Field label="Format">
          <Select value={format} onChange={(e) => setFormat(e.target.value as "csv" | "xlsx")}>
            <option value="csv">CSV</option>
            <option value="xlsx">XLSX</option>
          </Select>
        </Field>
        <Field
          label="Reason (min 5 characters)"
          error={reason.length > 0 && reasonLen < MIN_REASON ? "At least 5 characters required." : undefined}
        >
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this export needed?"
          />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || reasonLen < MIN_REASON}>
            {busy ? "Preparing…" : "Download export"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
