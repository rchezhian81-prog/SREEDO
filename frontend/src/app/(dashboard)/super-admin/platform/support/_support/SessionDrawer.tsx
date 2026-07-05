"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, ErrorNote, Modal, Spinner } from "@/components/ui";
import type { SupportSession } from "@/types";
import { RevokeModal } from "./RevokeModal";
import {
  formatDateTime,
  formatDuration,
  humanizeRole,
  moduleLabel,
  notifyLabel,
  notifyTone,
  scopeLabel,
  scopeTone,
  statusLabel,
  statusTone,
  templateLabel,
} from "./taxonomy";

/**
 * Single support-session detail. Fetches GET /platform/support/sessions/:id and
 * renders operator/target/tenant, scope + allowed modules, the full lifecycle
 * (start/expiry/end, duration, ended-by / revoked-by + reason), and network
 * context. An active session can be revoked (reason required) from here.
 */
export function SessionDrawer({
  id,
  onClose,
  onChanged,
}: {
  id: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [session, setSession] = useState<SupportSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setSession(await api.get<SupportSession>(`/platform/support/sessions/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load session");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) {
      setSession(null);
      setError(null);
      return;
    }
    load();
  }, [id, load]);

  const revoke = async (reason: string) => {
    if (!id) return;
    await api.post(`/platform/support/sessions/${id}/revoke`, { reason });
    await load();
    onChanged();
  };

  return (
    <>
      <Modal title="Support session" open={id !== null} onClose={onClose}>
        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorNote message={error} />
        ) : session ? (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={statusTone(session.status)}>{statusLabel(session.status)}</Badge>
              <Badge tone={scopeTone(session.scope)}>{scopeLabel(session.scope)}</Badge>
              {session.reasonTemplate && (
                <Badge tone="slate">{templateLabel(session.reasonTemplate)}</Badge>
              )}
            </div>

            <dl className="space-y-2">
              <Row label="Operator" value={session.operatorEmail ?? session.operatorName ?? "—"} />
              <Row
                label="Target"
                value={
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-ink">{session.targetEmail}</span>
                    <span className="capitalize text-faint">{humanizeRole(session.targetRole)}</span>
                  </span>
                }
              />
              <Row
                label="Tenant"
                value={
                  session.institutionId ? (
                    <Link
                      href={`/super-admin/platform/tenants/${session.institutionId}`}
                      onClick={onClose}
                      className="text-brand-600 hover:text-brand-700"
                    >
                      {session.institutionName ?? "View"}{" "}
                      {session.institutionCode && <span className="text-faint">({session.institutionCode})</span>}
                    </Link>
                  ) : (
                    "—"
                  )
                }
              />
              {session.scope === "module_limited" && (
                <Row
                  label="Modules"
                  value={
                    session.allowedModules.length ? (
                      <span className="flex flex-wrap gap-1">
                        {session.allowedModules.map((m) => (
                          <Badge key={m} tone="blue">
                            {moduleLabel(m)}
                          </Badge>
                        ))}
                      </span>
                    ) : (
                      "—"
                    )
                  }
                />
              )}
              {session.reason && <Row label="Reason" value={session.reason} />}
              <Row label="Started" value={formatDateTime(session.startedAt)} />
              <Row label="Expires" value={formatDateTime(session.expiresAt)} />
              <Row label="Ended" value={formatDateTime(session.endedAt)} />
              <Row label="Duration" value={formatDuration(session.durationMinutes)} />
              {(session.endedByEmail || session.endedBy) && (
                <Row label="Ended by" value={session.endedByEmail ?? session.endedBy ?? "—"} />
              )}
              {(session.revokedByEmail || session.revokedBy) && (
                <Row label="Revoked by" value={session.revokedByEmail ?? session.revokedBy ?? "—"} />
              )}
              {session.revokeReason && <Row label="Revoke reason" value={session.revokeReason} />}
              <Row
                label="Tenant notified"
                value={
                  <span className="flex flex-col gap-1">
                    <span>
                      <Badge tone={notifyTone(session.notifyStatus)}>
                        {notifyLabel(session.notifyStatus)}
                      </Badge>
                    </span>
                    {session.notifyDetail && (
                      <span className="text-xs text-faint">
                        {session.notifyDetail.recipient
                          ? `→ ${session.notifyDetail.recipient}`
                          : "No tenant recipient"}
                        {session.notifyDetail.at ? ` · ${formatDateTime(session.notifyDetail.at)}` : ""}
                      </span>
                    )}
                  </span>
                }
              />
              <Row label="IP" value={session.ip ?? "—"} mono />
              <Row label="User agent" value={session.userAgent ?? "—"} mono />
            </dl>

            <div className="flex justify-end gap-2">
              {session.status === "active" && (
                <Button variant="danger" onClick={() => setRevokeOpen(true)}>
                  Revoke access
                </Button>
              )}
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <RevokeModal
        open={revokeOpen}
        title="Revoke support session"
        description={
          session ? (
            <>
              Immediately end support access for{" "}
              <span className="font-semibold text-ink">{session.targetEmail}</span>. The
              impersonation token stops working at once. This is audited.
            </>
          ) : null
        }
        onConfirm={revoke}
        onClose={() => setRevokeOpen(false)}
      />
    </>
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
      <dt className="w-28 shrink-0 font-medium text-muted">{label}</dt>
      <dd className={mono ? "min-w-0 break-all font-mono text-xs text-ink" : "min-w-0 text-ink"}>
        {value}
      </dd>
    </div>
  );
}
