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
  Spinner,
  Textarea,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type { JobListResult, JobRow } from "@/types";
import { formatNumber } from "../../platform/_utils";
import { JobDetailModal } from "./JobDetailModal";
import { formatDateTime, isUuid, shortId } from "./taxonomy";

const MIN_REASON = 5;
const PAGE_SIZE = 50;

export function DeadLetterTab({ reloadKey }: { reloadKey: number }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [institutionId, setInstitutionId] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<JobListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localReload, setLocalReload] = useState(0);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [requeue, setRequeue] = useState<JobRow | null>(null);

  const filterKey = useMemo(() => `${q}|${type}|${institutionId}`, [q, type, institutionId]);
  useEffect(() => {
    setPage(1);
  }, [filterKey]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (type.trim()) p.set("type", type.trim());
    if (isUuid(institutionId)) p.set("institutionId", institutionId.trim());
    p.set("page", String(page));
    p.set("pageSize", String(PAGE_SIZE));
    return p.toString();
  }, [q, type, institutionId, page]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<JobListResult>(`/jobs-ops/dead-letter?${query}`));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load dead-letter queue");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load, reloadKey, localReload]);

  const refresh = () => setLocalReload((k) => k + 1);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="space-y-4">
      <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search id, type, reason, tenant…" aria-label="Search" />
        <Input value={type} onChange={(e) => setType(e.target.value)} placeholder="Job type (exact)" aria-label="Job type" />
        <Field label="Tenant UUID" error={institutionId && !isUuid(institutionId) ? "Enter a full UUID" : undefined}>
          <Input
            value={institutionId}
            onChange={(e) => setInstitutionId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
          />
        </Field>
      </Card>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="The dead-letter queue is empty." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Job</th>
                  <th className="px-4 py-3">Tenant</th>
                  <th className="px-4 py-3 text-right">Failures</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">First / last failed</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((j) => (
                  <tr key={j.id} className="hover:bg-hover">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setDetailId(j.id)}
                        className="block text-left font-medium text-ink hover:text-brand-600"
                      >
                        {j.type}
                      </button>
                      <span className="block text-xs text-faint">
                        {j.sourceModule} · {shortId(j.id)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">{j.institutionName ?? "Platform"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <Badge tone={j.attempts > 0 ? "red" : "slate"}>{formatNumber(j.attempts)}</Badge>
                    </td>
                    <td className="max-w-xs px-4 py-3 text-muted">
                      <span className="block truncate" title={j.deadLetterReason ?? undefined}>
                        {j.deadLetterReason ?? "—"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-faint">
                      <span className="block">{formatDateTime(j.createdAt)}</span>
                      <span className="block">{formatDateTime(j.deadLetteredAt)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button variant="secondary" className="!px-2.5 !py-1.5" onClick={() => setDetailId(j.id)}>
                          View
                        </Button>
                        <Button variant="secondary" className="!px-2.5 !py-1.5" onClick={() => setRequeue(j)}>
                          Requeue
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 text-sm text-muted">
            <span>
              Page {page} of {totalPages} · {formatNumber(total)} total
            </span>
            <Button variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              <Icon name="chevronLeft" className="h-4 w-4" />
              Prev
            </Button>
            <Button
              variant="secondary"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next
              <Icon name="chevronRight" className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}

      <JobDetailModal id={detailId} onClose={() => setDetailId(null)} onChanged={refresh} />

      <RequeueModal
        job={requeue}
        onClose={() => setRequeue(null)}
        onDone={() => {
          setRequeue(null);
          refresh();
        }}
      />
    </section>
  );
}

function RequeueModal({
  job,
  onClose,
  onDone,
}: {
  job: JobRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (job) {
      setReason("");
      setBusy(false);
      setError(null);
    }
  }, [job]);

  if (!job) return null;

  const reasonOk = reason.trim().length >= MIN_REASON;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/jobs-ops/jobs/${job.id}/requeue`, { reason: reason.trim() });
      toast.success("Job requeued from dead-letter.");
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Requeue failed");
      setBusy(false);
    }
  };

  return (
    <Modal title="Requeue job" open={job !== null} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          Requeueing resets <span className="font-mono text-xs text-ink">{shortId(job.id)}</span> ({job.type}) to
          pending so it can run again.
        </p>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          This action is audited. A reason of at least 5 characters is required.
        </div>
        <Field
          label="Reason (min 5 characters)"
          error={reason.length > 0 && !reasonOk ? "At least 5 characters required." : undefined}
        >
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why requeue this job?" />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !reasonOk}>
            {busy ? "Requeueing…" : "Requeue job"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
