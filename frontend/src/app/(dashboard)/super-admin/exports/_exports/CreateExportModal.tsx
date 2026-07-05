"use client";

import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, ErrorNote, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type { ExportFormat, ExportScope, PlatformExport } from "@/types";
import { CREATE_SCOPES, EXPORT_FORMATS, formatLabel, scopeMeta } from "./taxonomy";
import { useInstitutions } from "./useInstitutions";

const MIN_REASON = 5;

interface KeyVal {
  key: string;
  value: string;
}

/**
 * Create a governed platform export. Sensitive scopes reveal a required reason +
 * a SENSITIVE badge; approval-required scopes reveal a risk-justification field and
 * a warning that a second super-admin must approve before the artifact is built.
 * Standalone-unavailable scopes (students/staff/fees/attendance/exams) are shown
 * disabled with a "via Portability Pack" annotation.
 */
export function CreateExportModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const institutions = useInstitutions(open);

  const [name, setName] = useState("");
  const [scope, setScope] = useState<ExportScope>("institutions");
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [institutionId, setInstitutionId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [extra, setExtra] = useState<KeyVal[]>([]);
  const [reason, setReason] = useState("");
  const [riskReason, setRiskReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setScope("institutions");
      setFormat("csv");
      setInstitutionId("");
      setDateFrom("");
      setDateTo("");
      setStatusFilter("");
      setExtra([]);
      setReason("");
      setRiskReason("");
      setBusy(false);
      setError(null);
    }
  }, [open]);

  const meta = scopeMeta(scope);
  const sensitive = Boolean(meta?.sensitive);
  const needsApproval = Boolean(meta?.approval);
  const hasDateFilter = dateFrom.trim() !== "" || dateTo.trim() !== "";

  const standard = CREATE_SCOPES.filter((s) => !s.sensitive && !s.unavailable);
  const sensitiveScopes = CREATE_SCOPES.filter((s) => s.sensitive && !s.unavailable);
  const unavailable = CREATE_SCOPES.filter((s) => s.unavailable);

  const nameValid = name.trim().length >= 3;
  const reasonValid = !sensitive || reason.trim().length >= MIN_REASON;
  const canSubmit = nameValid && reasonValid && !busy;

  const filters = useMemo(() => {
    const f: Record<string, string> = {};
    if (dateFrom.trim()) f.dateFrom = dateFrom.trim();
    if (dateTo.trim()) f.dateTo = dateTo.trim();
    if (statusFilter.trim()) f.status = statusFilter.trim();
    for (const { key, value } of extra) {
      const k = key.trim();
      if (k) f[k] = value.trim();
    }
    return f;
  }, [dateFrom, dateTo, statusFilter, extra]);

  const patchExtra = (i: number, p: Partial<KeyVal>) =>
    setExtra((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...p } : row)));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<PlatformExport>("/exports", {
        name: name.trim(),
        scope,
        format,
        ...(institutionId ? { institutionId } : {}),
        ...(Object.keys(filters).length ? { filters } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(riskReason.trim() ? { riskReason: riskReason.trim() } : {}),
      });
      if (created.approvalStatus === "pending") {
        toast.info("Export requires approval before it is generated.");
      } else if (created.status === "completed") {
        toast.success("Export generated and ready to download.");
      } else {
        toast.success("Export created.");
      }
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create export");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Create export" open={open} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <Field label="Export name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Institutions snapshot — Q3"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Scope">
            <Select value={scope} onChange={(e) => setScope(e.target.value as ExportScope)}>
              <optgroup label="Standard">
                {standard.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Sensitive — reason required">
                {sensitiveScopes.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                    {s.approval ? " (approval)" : ""}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Per-tenant only — via Portability Pack">
                {unavailable.map((s) => (
                  <option key={s.value} value={s.value} disabled>
                    {s.label} — via Portability Pack
                  </option>
                ))}
              </optgroup>
            </Select>
          </Field>
          <Field label="Format">
            <Select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
              {EXPORT_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {formatLabel(f)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {(sensitive || needsApproval) && (
          <div className="flex flex-wrap items-center gap-2">
            {sensitive && (
              <Badge tone="red">
                <Icon name="shieldAlert" className="h-3.5 w-3.5" />
                Sensitive
              </Badge>
            )}
            {needsApproval && <Badge tone="amber">Approval required</Badge>}
          </div>
        )}

        {needsApproval ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            This scope always requires a second super-admin&apos;s approval. The artifact is only
            generated once another admin approves the request.
          </div>
        ) : sensitive && !hasDateFilter ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            A broad (undated) sensitive export needs a second super-admin&apos;s approval before it is
            generated. Add a date range below to narrow it and generate immediately.
          </div>
        ) : null}

        <Field label="Tenant (optional)" hint="Scope the export to a single institution where supported.">
          <Select value={institutionId} onChange={(e) => setInstitutionId(e.target.value)}>
            <option value="">All tenants</option>
            {institutions.map((inst) => (
              <option key={inst.id} value={inst.id}>
                {inst.name} ({inst.code})
              </option>
            ))}
          </Select>
        </Field>

        {/* Filters */}
        <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Filters (optional)</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">Date from</span>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">Date to</span>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">Status</span>
              <Input
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                placeholder="e.g. paid"
              />
            </label>
          </div>

          {extra.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={row.key}
                onChange={(e) => patchExtra(i, { key: e.target.value })}
                placeholder="key"
                aria-label="Filter key"
              />
              <Input
                value={row.value}
                onChange={(e) => patchExtra(i, { value: e.target.value })}
                placeholder="value"
                aria-label="Filter value"
              />
              <Button
                variant="ghost"
                onClick={() => setExtra((prev) => prev.filter((_, idx) => idx !== i))}
                aria-label="Remove filter"
              >
                <Icon name="x" className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            onClick={() => setExtra((prev) => [...prev, { key: "", value: "" }])}
          >
            <Icon name="plus" className="h-4 w-4" />
            Add filter
          </Button>
        </div>

        <Field
          label={sensitive ? "Reason (required — min 5 characters)" : "Reason (optional)"}
          hint="Recorded in the platform audit log."
          error={
            sensitive && reason.length > 0 && reason.trim().length < MIN_REASON
              ? "At least 5 characters required."
              : undefined
          }
        >
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this export needed?"
          />
        </Field>

        {needsApproval && (
          <Field label="Risk justification (optional)" hint="Shown to the approving super-admin.">
            <Textarea
              rows={2}
              value={riskReason}
              onChange={(e) => setRiskReason(e.target.value)}
              placeholder="Blast radius, who receives the data, retention…"
            />
          </Field>
        )}

        <ErrorNote message={error} />

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={sensitive ? "danger" : "primary"}
            onClick={submit}
            disabled={!canSubmit}
          >
            {busy ? "Creating…" : needsApproval ? "Request export" : "Create export"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
