"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { Button, ErrorNote, Field, Modal, Textarea } from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const MIN_REASON = 5;

type Format = "csv" | "xlsx";

/**
 * Governed CSV / XLSX export buttons for a support dataset (reports or history).
 *
 * Mirrors the SERVER rule: a reason (min 5) is REQUIRED for a BROAD export (no
 * dateFrom), so a broad export opens a small reason modal first while a
 * date-scoped export downloads directly. Streams the file via a raw fetch with the
 * bearer token (blob download — the JSON `api` helper can't stream a file) and
 * surfaces a server 400 (reason) / 403 (missing `platform:support_export`)
 * gracefully. `params` are the active filters only — never `reason`/`format`.
 */
export function ExportControls({
  endpoint,
  params,
  filename,
}: {
  endpoint: string;
  params: Record<string, string>;
  filename: string;
}) {
  // The format whose broad export is awaiting a reason (drives the modal).
  const [pending, setPending] = useState<Format | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);

  // No start date → broad, all-time export → the server requires a reason.
  const broad = !params.dateFrom;
  const reasonTooShort = reason.trim().length < MIN_REASON;

  const runDownload = async (format: Format, withReason: string, viaModal: boolean) => {
    setBusy(format);
    setError(null);
    try {
      const token = useAuthStore.getState().accessToken;
      const p = new URLSearchParams(params);
      p.set("format", format);
      if (withReason.trim()) p.set("reason", withReason.trim());
      const res = await fetch(`${API_URL}${endpoint}?${p.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        if (res.status === 403) {
          throw new ApiError(
            403,
            "You don't have permission to export support data (needs platform:support_export)."
          );
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
      a.download = `${filename}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success(`Export ready (${format.toUpperCase()}).`);
      setPending(null);
      setReason("");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to export support data";
      // Broad exports show the error inside the modal; direct downloads via a toast.
      if (viaModal) setError(message);
      else toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  const onClick = (format: Format) => {
    if (broad) {
      setReason("");
      setError(null);
      setPending(format);
    } else {
      runDownload(format, "", false);
    }
  };

  return (
    <>
      <div className="inline-flex items-center gap-2">
        <Button variant="secondary" onClick={() => onClick("csv")} disabled={busy !== null}>
          <Icon name="file" className="h-4 w-4" />
          CSV
        </Button>
        <Button variant="secondary" onClick={() => onClick("xlsx")} disabled={busy !== null}>
          <Icon name="file" className="h-4 w-4" />
          XLSX
        </Button>
      </div>

      <Modal title="Export — reason required" open={pending !== null} onClose={() => setPending(null)}>
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            No start date is set — this is a broad, all-time export (capped at 50,000 rows) and
            requires a reason for the audit trail.
          </div>
          <Field
            label="Reason (min 5 characters)"
            hint="Recorded in the platform audit log."
            error={reason.length > 0 && reasonTooShort ? "At least 5 characters required." : undefined}
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
            <Button variant="secondary" onClick={() => setPending(null)} disabled={busy !== null}>
              Cancel
            </Button>
            <Button
              onClick={() => pending && runDownload(pending, reason, true)}
              disabled={busy !== null || reasonTooShort}
            >
              {busy ? "Exporting…" : `Download ${pending?.toUpperCase() ?? ""}`}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
