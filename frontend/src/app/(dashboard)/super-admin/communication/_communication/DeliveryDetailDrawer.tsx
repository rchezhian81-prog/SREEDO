"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, ErrorNote, Field, Spinner, Textarea } from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type { DeliveryDetail, DeliveryRetryResult } from "@/types";
import {
  deliveryStatusTone,
  formatDateTime,
  humanizeToken,
  shortId,
  sourceLabel,
  titleCase,
} from "./taxonomy";

export function DeliveryDetailDrawer({
  id,
  onClose,
  onChanged,
}: {
  id: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [row, setRow] = useState<DeliveryDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryOpen, setRetryOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setRow(await api.get<DeliveryDetail>(`/comm-admin/deliveries/${id}`));
    } catch (err) {
      setRow(null);
      setError(err instanceof ApiError ? err.message : "Failed to load delivery");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) {
      setRetryOpen(false);
      setReason("");
      setBusy(false);
      load();
    }
  }, [id, load]);

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [id, onClose]);

  if (!id) return null;

  const isLegacy = row?.source === "invoice";
  const canRetry = row?.status === "failed" && !isLegacy;

  const doRetry = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<DeliveryRetryResult>(
        `/comm-admin/deliveries/${id}/retry`,
        reason.trim() ? { reason: reason.trim() } : {}
      );
      toast.success(`Delivery re-sent (${res.status}).`);
      setRetryOpen(false);
      setReason("");
      onChanged();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Retry failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/55 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Delivery detail"
        className="h-full w-full max-w-md overflow-y-auto border-l border-line bg-surface shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-lg font-bold text-ink">Delivery detail</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-faint transition hover:bg-hover hover:text-ink"
            aria-label="Close"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5 text-sm">
          {loading ? (
            <Spinner />
          ) : !row ? (
            <ErrorNote message={error ?? "Delivery not found."} />
          ) : (
            <>
              {/* Status header */}
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={deliveryStatusTone(row.status)}>{titleCase(row.status)}</Badge>
                <Badge tone="slate">{sourceLabel(row.triggerSource)}</Badge>
                {isLegacy && <Badge tone="amber">Legacy invoice</Badge>}
                <span className="font-mono text-xs text-faint">{shortId(row.id)}</span>
              </div>

              {/* Core fields */}
              <dl className="grid gap-2">
                <Row label="Recipient" value={row.recipient} />
                {row.recipientName && <Row label="Name" value={row.recipientName} />}
                <Row label="Subject" value={row.subject ?? "—"} />
                <Row label="Template" value={row.template ?? "—"} />
                <Row label="Category" value={row.category ? titleCase(row.category) : "—"} />
                <Row
                  label="Tenant"
                  value={
                    row.institutionName
                      ? `${row.institutionName}${row.institutionCode ? ` (${row.institutionCode})` : ""}`
                      : "Platform"
                  }
                />
                <Row label="Retries" value={String(row.retryCount)} />
                <Row label="Source" value={titleCase(row.source)} />
              </dl>

              {/* Status timeline */}
              <div>
                <SubHeading>Status timeline</SubHeading>
                <ol className="space-y-2">
                  <TimelineStep label="Queued" at={row.createdAt} tone="slate" done />
                  <TimelineStep
                    label={row.status === "failed" ? "Failed" : row.status === "skipped" ? "Skipped" : "Sent / delivered"}
                    at={row.sentAt}
                    tone={deliveryStatusTone(row.status)}
                    done={row.status !== "pending"}
                  />
                </ol>
              </div>

              {/* Masked failure / provider response */}
              {row.failureReason && (
                <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                  <span className="font-semibold">Failure reason (masked):</span> {row.failureReason}
                </div>
              )}
              {row.providerResponse && (
                <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
                  <span className="font-semibold text-ink">Provider response (masked):</span> {row.providerResponse}
                </div>
              )}

              {/* Related entities */}
              {(row.relatedType || row.broadcastId || row.jobId) && (
                <div>
                  <SubHeading>Related entities</SubHeading>
                  <div className="flex flex-wrap gap-2">
                    {row.relatedType && row.relatedId && <RefChip label={row.relatedType} id={row.relatedId} />}
                    {row.broadcastId && <RefChip label="broadcast" id={row.broadcastId} />}
                    {row.jobId && <RefChip label="job" id={row.jobId} />}
                  </div>
                </div>
              )}

              {/* Secure-link notice */}
              <p className="text-xs text-faint">
                Secure links (tokens, reset, payment, verify) are omitted from delivery logs and exports.
              </p>

              {/* Retry */}
              {isLegacy ? (
                <p
                  className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-faint"
                  title="Legacy invoice email deliveries are read-only and cannot be retried here."
                >
                  Legacy invoice delivery — read-only, cannot be retried.
                </p>
              ) : canRetry ? (
                retryOpen ? (
                  <div className="space-y-2 rounded-lg border border-line bg-surface-2 p-3">
                    <Field label="Reason (optional)" hint="Retry is audited.">
                      <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why retry this delivery?" />
                    </Field>
                    <ErrorNote message={error} />
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" onClick={() => setRetryOpen(false)} disabled={busy}>
                        Cancel
                      </Button>
                      <Button onClick={doRetry} disabled={busy}>
                        {busy ? "Retrying…" : "Retry delivery"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-end">
                    <Button variant="secondary" onClick={() => setRetryOpen(true)}>
                      <Icon name="history" className="h-4 w-4" />
                      Retry delivery
                    </Button>
                  </div>
                )
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 font-medium text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{value}</dd>
    </div>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{children}</p>;
}

function TimelineStep({
  label,
  at,
  tone,
  done,
}: {
  label: string;
  at: string | null;
  tone: "slate" | "green" | "amber" | "red" | "blue";
  done: boolean;
}) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={`h-2.5 w-2.5 shrink-0 rounded-full ${
          done ? (tone === "red" ? "bg-red-500" : tone === "green" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : "bg-brand-500") : "bg-line"
        }`}
      />
      <span className="text-ink">{label}</span>
      <span className="ml-auto text-xs text-faint">{formatDateTime(at)}</span>
    </li>
  );
}

function RefChip({ label, id }: { label: string; id: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-xs">
      <Icon name="link" className="h-3.5 w-3.5 text-faint" />
      <span className="capitalize text-muted">{humanizeToken(label)}</span>
      <span className="font-mono text-faint">{shortId(id)}</span>
    </span>
  );
}
