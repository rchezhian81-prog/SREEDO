"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  ConfirmDialog,
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
import type {
  AdminInstitutionBrief,
  AudiencePreview,
  Broadcast,
  BroadcastAudience,
  BroadcastChannel,
} from "@/types";
import { formatNumber } from "../../platform/_utils";
import {
  BROADCAST_AUDIENCES,
  BROADCAST_CHANNELS,
  INSTITUTION_TYPES,
  audienceLabel,
  audienceNeedsInstitution,
  audienceNeedsType,
  broadcastStatusTone,
  channelLabel,
  formatDateTime,
  isBroadAudience,
  isUuid,
  titleCase,
} from "./taxonomy";

const MIN_REASON = 5;

interface FormState {
  title: string;
  bodyText: string;
  bodyHtml: string;
  audience: BroadcastAudience;
  channel: BroadcastChannel;
  institutionId: string;
  institutionType: string;
}

const EMPTY_FORM: FormState = {
  title: "",
  bodyText: "",
  bodyHtml: "",
  audience: "platform_admins",
  channel: "email",
  institutionId: "",
  institutionType: "school",
};

type Panel = "none" | "send" | "schedule" | "cancel";

export function BroadcastEditorModal({
  id,
  open,
  onClose,
  onChanged,
}: {
  /** undefined handled by caller; null = create; string = edit that id. */
  id: string | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [workingId, setWorkingId] = useState<string | null>(id);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [institutions, setInstitutions] = useState<AdminInstitutionBrief[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [panel, setPanel] = useState<Panel>("none");
  const [audiencePreview, setAudiencePreview] = useState<AudiencePreview | null>(null);
  const [scheduledAt, setScheduledAt] = useState("");
  const [reason, setReason] = useState("");

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const applyBroadcast = (b: Broadcast) => {
    setBroadcast(b);
    setForm({
      title: b.title,
      bodyText: b.bodyText,
      bodyHtml: b.bodyHtml ?? "",
      audience: b.audience,
      channel: b.channel,
      institutionId: (b.audienceFilter?.institutionId as string) ?? "",
      institutionType: (b.audienceFilter?.institutionType as string) ?? "school",
    });
  };

  const load = useCallback(async (loadId: string | null) => {
    if (loadId === null) {
      setBroadcast(null);
      setForm(EMPTY_FORM);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const b = await api.get<Broadcast>(`/comm-admin/broadcasts/${loadId}`);
      applyBroadcast(b);
    } catch (err) {
      setBroadcast(null);
      setError(err instanceof ApiError ? err.message : "Failed to load broadcast");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setWorkingId(id);
    setPanel("none");
    setAudiencePreview(null);
    setScheduledAt("");
    setReason("");
    setBusy(false);
    setError(null);
    load(id);
  }, [open, id, load]);

  // Institution list for the specific_tenant picker (deferred).
  useEffect(() => {
    if (!open || form.audience !== "specific_tenant" || institutions.length > 0) return;
    let live = true;
    api
      .get<AdminInstitutionBrief[]>("/admin/institutions")
      .then((r) => {
        if (live) setInstitutions(r);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open, form.audience, institutions.length]);

  const isCreate = workingId === null;
  const status = broadcast?.status ?? "draft";
  const editable = isCreate || status === "draft";
  const broad = isBroadAudience(form.audience);

  const audienceFilterBody = (): Record<string, unknown> | undefined => {
    if (audienceNeedsInstitution(form.audience)) return { institutionId: form.institutionId.trim() };
    if (audienceNeedsType(form.audience)) return { institutionType: form.institutionType };
    return undefined;
  };

  const filterValid =
    (!audienceNeedsInstitution(form.audience) || isUuid(form.institutionId)) &&
    (!audienceNeedsType(form.audience) || !!form.institutionType);

  // ---- mutations -----------------------------------------------------------

  const buildWriteBody = (): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      title: form.title.trim(),
      bodyText: form.bodyText,
      bodyHtml: form.bodyHtml.trim() ? form.bodyHtml : null,
      audience: form.audience,
      channel: form.channel,
    };
    const filter = audienceFilterBody();
    if (filter) body.audienceFilter = filter;
    return body;
  };

  const doCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<Broadcast>("/comm-admin/broadcasts", buildWriteBody());
      toast.success("Broadcast draft created.");
      setWorkingId(created.id);
      applyBroadcast(created);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create broadcast");
    } finally {
      setBusy(false);
    }
  };

  const doSave = async () => {
    if (workingId === null) return;
    setBusy(true);
    setError(null);
    try {
      const b = await api.patch<Broadcast>(`/comm-admin/broadcasts/${workingId}`, buildWriteBody());
      applyBroadcast(b);
      toast.success("Broadcast saved.");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save broadcast");
    } finally {
      setBusy(false);
    }
  };

  const doPreviewAudience = async () => {
    if (workingId === null) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { audience: form.audience };
      const filter = audienceFilterBody();
      if (filter) body.audienceFilter = filter;
      const res = await api.post<AudiencePreview>(`/comm-admin/broadcasts/${workingId}/preview-audience`, body);
      setAudiencePreview(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to resolve audience");
    } finally {
      setBusy(false);
    }
  };

  const openSend = async () => {
    if (workingId === null) return;
    setReason("");
    setError(null);
    setBusy(true);
    try {
      // Resolve the STORED-config count (this is what send will target).
      const res = await api.post<AudiencePreview>(`/comm-admin/broadcasts/${workingId}/preview-audience`, {});
      setAudiencePreview(res);
      setPanel("send");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to resolve audience");
    } finally {
      setBusy(false);
    }
  };

  const doSend = async () => {
    if (workingId === null) return;
    setBusy(true);
    setError(null);
    try {
      const body = reason.trim() ? { reason: reason.trim() } : {};
      const b = await api.post<Broadcast>(`/comm-admin/broadcasts/${workingId}/send`, body);
      applyBroadcast(b);
      toast.success("Broadcast queued for sending.");
      setPanel("none");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send broadcast");
    } finally {
      setBusy(false);
    }
  };

  const doSchedule = async () => {
    if (workingId === null || !scheduledAt) return;
    setBusy(true);
    setError(null);
    try {
      const iso = new Date(scheduledAt).toISOString();
      const b = await api.post<Broadcast>(`/comm-admin/broadcasts/${workingId}/schedule`, { scheduledAt: iso });
      applyBroadcast(b);
      toast.success("Broadcast scheduled.");
      setPanel("none");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to schedule broadcast");
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    if (workingId === null) return;
    setBusy(true);
    setError(null);
    try {
      const b = await api.post<Broadcast>(`/comm-admin/broadcasts/${workingId}/cancel`, { reason: reason.trim() });
      applyBroadcast(b);
      toast.success("Broadcast cancelled.");
      setPanel("none");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to cancel broadcast");
    } finally {
      setBusy(false);
    }
  };

  const title = isCreate ? "New broadcast" : broadcast ? broadcast.title : "Broadcast";
  const sendBroad = isBroadAudience(broadcast?.audience);
  const sendReasonOk = !sendBroad || reason.trim().length >= MIN_REASON;

  return (
    <Modal open={open} title={title} onClose={onClose}>
      {loading ? (
        <Spinner />
      ) : !isCreate && !broadcast ? (
        <ErrorNote message={error ?? "Broadcast not found."} />
      ) : (
        <div className="space-y-4 text-sm">
          {broadcast && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={broadcastStatusTone(broadcast.status)}>{titleCase(broadcast.status)}</Badge>
              <Badge tone="slate">{audienceLabel(broadcast.audience)}</Badge>
              <Badge tone="slate">{channelLabel(broadcast.channel)}</Badge>
              {isBroadAudience(broadcast.audience) && <Badge tone="amber">Broad</Badge>}
            </div>
          )}

          {/* Delivery summary (once sent/sending) */}
          {broadcast && (broadcast.status === "sent" || broadcast.status === "sending" || broadcast.status === "failed") && (
            <div className="grid grid-cols-3 gap-2 rounded-xl border border-line bg-surface-2 p-3 text-center">
              <Summary label="Recipients" value={broadcast.recipientCount} />
              <Summary label="Sent" value={broadcast.sentCount} tone="green" />
              <Summary label="Failed" value={broadcast.failedCount} tone={broadcast.failedCount > 0 ? "red" : undefined} />
            </div>
          )}

          {!editable && (
            <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-faint">
              Only draft broadcasts can be edited. This broadcast is {status}.
            </p>
          )}

          <Field label="Title">
            <Input value={form.title} onChange={(e) => patch({ title: e.target.value })} placeholder="Broadcast title" disabled={!editable} />
          </Field>
          <Field label="Body (plain text)">
            <Textarea rows={5} value={form.bodyText} onChange={(e) => patch({ bodyText: e.target.value })} placeholder="Message…" disabled={!editable} />
          </Field>
          <Field label="Body (HTML, optional)" hint="Scripts are stripped server-side.">
            <Textarea rows={3} value={form.bodyHtml} onChange={(e) => patch({ bodyHtml: e.target.value })} placeholder="<p>Optional HTML…</p>" disabled={!editable} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Audience">
              <Select
                value={form.audience}
                onChange={(e) => {
                  patch({ audience: e.target.value as BroadcastAudience });
                  setAudiencePreview(null);
                }}
                disabled={!editable}
              >
                {BROADCAST_AUDIENCES.map((a) => (
                  <option key={a} value={a}>
                    {audienceLabel(a)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Channel">
              <Select value={form.channel} onChange={(e) => patch({ channel: e.target.value as BroadcastChannel })} disabled={!editable}>
                {BROADCAST_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {channelLabel(c)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {audienceNeedsInstitution(form.audience) && (
            <Field label="Institution" error={form.institutionId && !isUuid(form.institutionId) ? "Select an institution." : undefined}>
              <Select value={form.institutionId} onChange={(e) => patch({ institutionId: e.target.value })} disabled={!editable}>
                <option value="">Select an institution…</option>
                {institutions.map((inst) => (
                  <option key={inst.id} value={inst.id}>
                    {inst.name} ({inst.code})
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {audienceNeedsType(form.audience) && (
            <Field label="Institution type">
              <Select value={form.institutionType} onChange={(e) => patch({ institutionType: e.target.value })} disabled={!editable}>
                {INSTITUTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {titleCase(t)}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {broad && editable && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              This is a broad audience — sending requires a reason of at least 5 characters and a confirmation.
            </div>
          )}

          {/* Audience preview result */}
          {audiencePreview && panel === "none" && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs">
              <span className="font-semibold text-ink">Audience:</span>
              <span className="text-muted">{audienceLabel(audiencePreview.audience)}</span>
              <Badge tone="blue">{formatNumber(audiencePreview.recipientCount)} recipients</Badge>
              {audiencePreview.broad && <Badge tone="amber">Broad</Badge>}
            </div>
          )}

          <ErrorNote message={error} />

          {/* Action bar */}
          {panel === "none" && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                {!isCreate && (
                  <Button variant="secondary" onClick={doPreviewAudience} disabled={busy || !filterValid}>
                    <Icon name="users" className="h-4 w-4" />
                    Preview audience
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {isCreate ? (
                  <Button onClick={doCreate} disabled={busy || form.title.trim().length < 2 || !filterValid}>
                    {busy ? "Saving…" : "Save draft"}
                  </Button>
                ) : (
                  <>
                    {editable && (
                      <Button variant="secondary" onClick={doSave} disabled={busy || form.title.trim().length < 2 || !filterValid}>
                        {busy ? "Saving…" : "Save"}
                      </Button>
                    )}
                    {(status === "draft" || status === "scheduled") && (
                      <>
                        <Button variant="secondary" onClick={() => setPanel("schedule")} disabled={busy}>
                          <Icon name="calendarClock" className="h-4 w-4" />
                          {status === "scheduled" ? "Reschedule" : "Schedule"}
                        </Button>
                        <Button onClick={openSend} disabled={busy}>
                          <Icon name="megaphone" className="h-4 w-4" />
                          Send
                        </Button>
                      </>
                    )}
                    {status === "scheduled" && (
                      <Button variant="danger" onClick={() => { setReason(""); setPanel("cancel"); }} disabled={busy}>
                        Cancel broadcast
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Schedule panel */}
          {panel === "schedule" && (
            <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Schedule broadcast</p>
              <Field label="Send at" hint="The scheduler enqueues it when due.">
                <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
              </Field>
              <ErrorNote message={error} />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setPanel("none")} disabled={busy}>
                  Back
                </Button>
                <Button onClick={doSchedule} disabled={busy || !scheduledAt}>
                  {busy ? "Scheduling…" : "Schedule"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Send confirm */}
      <ConfirmDialog
        open={panel === "send"}
        title="Send broadcast"
        tone={sendBroad ? "danger" : "primary"}
        confirmLabel="Send now"
        busy={busy}
        confirmDisabled={!sendReasonOk}
        onClose={() => setPanel("none")}
        onConfirm={doSend}
        message={
          <div className="space-y-3">
            <p>
              This will send to{" "}
              <span className="font-semibold text-ink">
                {formatNumber(audiencePreview?.recipientCount ?? broadcast?.recipientCount ?? 0)}
              </span>{" "}
              recipient(s) via {channelLabel(broadcast?.channel)} to{" "}
              <span className="font-semibold text-ink">{audienceLabel(broadcast?.audience)}</span>.
            </p>
            {sendBroad && (
              <>
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  Broad audience — a reason of at least 5 characters is required. This also raises a security event.
                </div>
                <Field
                  label="Reason (min 5 characters)"
                  error={reason.length > 0 && reason.trim().length < MIN_REASON ? "At least 5 characters required." : undefined}
                >
                  <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this broadcast being sent?" />
                </Field>
              </>
            )}
          </div>
        }
      />

      {/* Cancel confirm */}
      <ConfirmDialog
        open={panel === "cancel"}
        title="Cancel broadcast"
        tone="danger"
        confirmLabel="Cancel broadcast"
        busy={busy}
        confirmDisabled={reason.trim().length < MIN_REASON}
        onClose={() => setPanel("none")}
        onConfirm={doCancel}
        message={
          <div className="space-y-3">
            <p>Cancelling a scheduled broadcast prevents it from sending. It is never hard-deleted.</p>
            <Field
              label="Reason (min 5 characters)"
              error={reason.length > 0 && reason.trim().length < MIN_REASON ? "At least 5 characters required." : undefined}
            >
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why cancel this broadcast?" />
            </Field>
          </div>
        }
      />

      {broadcast && (
        <p className="mt-3 text-xs text-faint">
          {broadcast.scheduledAt && `Scheduled ${formatDateTime(broadcast.scheduledAt)} · `}
          {broadcast.sentAt && `Sent ${formatDateTime(broadcast.sentAt)} · `}
          Updated {formatDateTime(broadcast.updatedAt)}
        </p>
      )}
    </Modal>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone?: "green" | "red" }) {
  const color = tone === "green" ? "text-emerald-600" : tone === "red" ? "text-red-600" : "text-ink";
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-lg font-semibold ${color}`}>{formatNumber(value)}</p>
    </div>
  );
}
