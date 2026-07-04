"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, ErrorNote, Modal, Spinner } from "@/components/ui";
import type { AuditEventDetail } from "@/types";
import { DiffView } from "./DiffView";
import {
  formatDateTime,
  humanizeRole,
  resultLabel,
  resultTone,
  severityLabel,
  severityTone,
} from "./taxonomy";

/**
 * Single-event detail drawer. Fetches GET /platform/audit/:id for the given id
 * and renders the computed badges, actor / target / institution, network context,
 * reason, extracted before/after diff and the FULL (already-masked) metadata.
 * Opened from the results table, the recent-critical list and the alerts feed.
 */
export function DetailDrawer({
  id,
  onClose,
  onFilterActor,
}: {
  id: string | null;
  onClose: () => void;
  onFilterActor: (actorId: string) => void;
}) {
  const [event, setEvent] = useState<AuditEventDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setEvent(null);
      setError(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    setEvent(null);
    api
      .get<AuditEventDetail>(`/platform/audit/${id}`)
      .then((d) => {
        if (active) setEvent(d);
      })
      .catch((err) => {
        if (active)
          setError(err instanceof ApiError ? err.message : "Failed to load event");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  const requestId =
    event && typeof event.metadata?.requestId === "string"
      ? (event.metadata.requestId as string)
      : null;

  return (
    <Modal title="Audit event" open={id !== null} onClose={onClose}>
      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : event ? (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={severityTone(event.severity)}>
              {severityLabel(event.severity)}
            </Badge>
            <Badge tone={resultTone(event.result)}>{resultLabel(event.result)}</Badge>
            {event.category && <Badge tone="slate">{event.category}</Badge>}
          </div>

          <p className="font-mono text-xs text-slate-700">{event.action}</p>

          <dl className="space-y-2">
            <Row label="Time" value={formatDateTime(event.timestamp)} />
            <Row
              label="Actor"
              value={
                event.actor.email ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-700">{event.actor.email}</span>
                    <span className="capitalize text-slate-400">
                      {humanizeRole(event.actor.role)}
                    </span>
                    {event.actor.id && (
                      <button
                        type="button"
                        onClick={() => onFilterActor(event.actor.id!)}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700"
                      >
                        Filter by actor →
                      </button>
                    )}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <Row
              label="Target"
              value={<TargetValue target={event.target} onClose={onClose} />}
            />
            <Row
              label="Institution"
              value={
                event.institution ? (
                  <Link
                    href={`/super-admin/platform/tenants/${event.institution.id}`}
                    onClick={onClose}
                    className="text-brand-600 hover:text-brand-700"
                  >
                    {event.institution.name} ({event.institution.code})
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            <Row label="IP" value={event.ip ?? "—"} mono />
            <Row label="User agent" value={event.userAgent ?? "—"} mono />
            {requestId && <Row label="Request ID" value={requestId} mono />}
            {event.reason && <Row label="Reason" value={event.reason} />}
          </dl>

          <div>
            <p className="mb-1.5 font-medium text-slate-700">Before / after</p>
            <DiffView diff={event.diff} />
          </div>

          <div>
            <p className="mb-1.5 font-medium text-slate-700">
              Metadata{" "}
              <span className="font-normal text-slate-400">(secrets masked)</span>
            </p>
            <pre className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-700">
              {JSON.stringify(event.metadata ?? {}, null, 2)}
            </pre>
          </div>

          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function TargetValue({
  target,
  onClose,
}: {
  target: AuditEventDetail["target"];
  onClose: () => void;
}) {
  if (!target.type && !target.id) return <span className="text-slate-400">—</span>;
  const name = target.name ?? target.id ?? "—";
  const isInstitution = target.type === "institution" || target.type === "tenant";
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {target.type && (
        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">
          {target.type}
        </span>
      )}
      {isInstitution && target.id ? (
        <Link
          href={`/super-admin/platform/tenants/${target.id}`}
          onClick={onClose}
          className="text-brand-600 hover:text-brand-700"
        >
          {name}
        </Link>
      ) : (
        <span className="text-slate-700">{name}</span>
      )}
    </span>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 font-medium text-slate-500">{label}</dt>
      <dd
        className={
          mono
            ? "min-w-0 break-all font-mono text-xs text-slate-700"
            : "min-w-0 text-slate-700"
        }
      >
        {value}
      </dd>
    </div>
  );
}
