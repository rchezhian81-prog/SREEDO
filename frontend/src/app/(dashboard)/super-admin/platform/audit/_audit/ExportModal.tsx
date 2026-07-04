"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { Button, ErrorNote, Field, Modal, Select, Textarea } from "@/components/ui";
import { appendFilters, type AuditFilterState } from "./taxonomy";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

/**
 * Governed export dialog. Mirrors the SERVER rule for when a reason is required
 * (high-severity OR broad / no dateFrom) so the field is enforced before the
 * request, and still surfaces a server 400 (reason) or 403 (permission) message.
 */
export function ExportModal({
  open,
  onClose,
  filters,
  sort,
  order,
}: {
  open: boolean;
  onClose: () => void;
  filters: AuditFilterState;
  sort: string;
  order: "asc" | "desc";
}) {
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same condition the backend enforces (audit.service.exportNeedsReason).
  const highSeverity = filters.severity === "high_risk" || filters.severity === "critical";
  const broad = !filters.dateFrom;
  const needsReason = highSeverity || broad;
  const reasonTooShort = needsReason && reason.trim().length < 5;

  const download = async () => {
    if (reasonTooShort) {
      setError("A reason of at least 5 characters is required for this export.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = useAuthStore.getState().accessToken;
      const p = new URLSearchParams();
      appendFilters(p, filters);
      p.set("sort", sort);
      p.set("order", order);
      p.set("format", format);
      if (reason.trim()) p.set("reason", reason.trim());
      const res = await fetch(`${API_URL}/platform/audit/export?${p.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        if (res.status === 403) {
          throw new ApiError(403, "You don't have permission to export the audit log.");
        }
        let message = res.statusText;
        try {
          const data = await res.json();
          if (typeof data.error === "string") message = data.error;
        } catch {
          // non-JSON error body — keep statusText
        }
        throw new ApiError(res.status, message);
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `platform-audit.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to export audit log");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Export audit log" open={open} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Exports the currently-filtered events. Every cell is masked of secrets by
          the server and the export itself is recorded in the audit log.
        </p>

        <Field label="Format">
          <Select value={format} onChange={(e) => setFormat(e.target.value as "csv" | "xlsx")}>
            <option value="csv">CSV</option>
            <option value="xlsx">XLSX</option>
          </Select>
        </Field>

        {broad && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            No start date is set — this is a broad, all-time export (capped at 50,000
            rows) and requires a reason.
          </div>
        )}
        {highSeverity && !broad && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            High-severity exports require a reason for the audit trail.
          </div>
        )}

        {needsReason && (
          <Field
            label="Reason"
            hint="Recorded in the audit log. Minimum 5 characters."
            error={
              reason.length > 0 && reasonTooShort
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
        )}

        <ErrorNote message={error} />

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={download} disabled={busy || reasonTooShort}>
            {busy ? "Exporting…" : "Download"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
