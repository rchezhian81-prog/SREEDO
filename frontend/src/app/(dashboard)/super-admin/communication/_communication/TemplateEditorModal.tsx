"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
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
  CommTemplateStatus,
  EmailTemplate,
  TemplateCategory,
  TemplatePreview,
  TemplateVersion,
  TestSendResult,
} from "@/types";
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_STATUSES,
  TEMPLATE_VARS,
  formatDateTime,
  isTestAddress,
  templateStatusTone,
  titleCase,
} from "./taxonomy";

const MIN_REASON = 5;
const KEY_RE = /^[a-z0-9_]+$/;

interface FormState {
  key: string;
  name: string;
  category: TemplateCategory;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  description: string;
  status: CommTemplateStatus;
  changeNote: string;
}

const EMPTY_FORM: FormState = {
  key: "",
  name: "",
  category: "general",
  subject: "",
  bodyText: "",
  bodyHtml: "",
  description: "",
  status: "active",
  changeNote: "",
};

type Panel = "none" | "test" | "versions";

export function TemplateEditorModal({
  templateKey,
  open,
  onClose,
  onChanged,
}: {
  /** null = create a new custom template; a key = edit that template. */
  templateKey: string | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const isCreate = templateKey === null;

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [tmpl, setTmpl] = useState<EmailTemplate | null>(null);
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [panel, setPanel] = useState<Panel>("none");
  const [preview, setPreview] = useState<TemplatePreview | null>(null);

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastFocused = useRef<"subject" | "body">("body");

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const load = useCallback(async () => {
    if (templateKey === null) {
      setForm(EMPTY_FORM);
      setTmpl(null);
      setVersions([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const t = await api.get<EmailTemplate>(`/comm-admin/templates/${encodeURIComponent(templateKey)}`);
      setTmpl(t);
      setVersions(t.versions ?? []);
      setForm({
        key: t.key,
        name: t.name,
        category: t.category as TemplateCategory,
        subject: t.subject,
        bodyText: t.bodyText,
        bodyHtml: t.bodyHtml ?? "",
        description: t.description ?? "",
        status: t.status,
        changeNote: "",
      });
    } catch (err) {
      setTmpl(null);
      setError(err instanceof ApiError ? err.message : "Failed to load template");
    } finally {
      setLoading(false);
    }
  }, [templateKey]);

  useEffect(() => {
    if (!open) return;
    setPanel("none");
    setPreview(null);
    setBusy(false);
    setError(null);
    load();
  }, [open, load]);

  const reloadDetail = async () => {
    if (templateKey === null) return;
    try {
      const t = await api.get<EmailTemplate>(`/comm-admin/templates/${encodeURIComponent(templateKey)}`);
      setTmpl(t);
      setVersions(t.versions ?? []);
      setForm((f) => ({ ...f, status: t.status, changeNote: "" }));
    } catch {
      /* keep current view */
    }
  };

  const insertVar = (name: string) => {
    const token = `{{${name}}}`;
    if (lastFocused.current === "subject") {
      const el = subjectRef.current;
      const start = el?.selectionStart ?? form.subject.length;
      const end = el?.selectionEnd ?? form.subject.length;
      const next = form.subject.slice(0, start) + token + form.subject.slice(end);
      patch({ subject: next });
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + token.length, start + token.length);
      });
    } else {
      const el = bodyRef.current;
      const start = el?.selectionStart ?? form.bodyText.length;
      const end = el?.selectionEnd ?? form.bodyText.length;
      const next = form.bodyText.slice(0, start) + token + form.bodyText.slice(end);
      patch({ bodyText: next });
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + token.length, start + token.length);
      });
    }
  };

  // ---- mutations -----------------------------------------------------------

  const doCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        key: form.key.trim(),
        name: form.name.trim(),
        category: form.category,
        subject: form.subject,
        bodyText: form.bodyText,
        status: form.status,
      };
      if (form.bodyHtml.trim()) body.bodyHtml = form.bodyHtml;
      if (form.description.trim()) body.description = form.description.trim();
      await api.post<EmailTemplate>("/comm-admin/templates", body);
      toast.success("Template created.");
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create template");
      setBusy(false);
    }
  };

  const doSave = async () => {
    if (templateKey === null) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        category: form.category,
        subject: form.subject,
        bodyText: form.bodyText,
        bodyHtml: form.bodyHtml.trim() ? form.bodyHtml : null,
        description: form.description.trim() ? form.description.trim() : null,
      };
      if (form.changeNote.trim()) body.changeNote = form.changeNote.trim();
      await api.patch<EmailTemplate>(`/comm-admin/templates/${encodeURIComponent(templateKey)}`, body);
      toast.success("Template saved (a new version was recorded).");
      onChanged();
      await reloadDetail();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save template");
    } finally {
      setBusy(false);
    }
  };

  const doPublish = async (status: CommTemplateStatus) => {
    if (templateKey === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.post<EmailTemplate>(`/comm-admin/templates/${encodeURIComponent(templateKey)}/publish`, { status });
      toast.success(`Template ${status === "active" ? "published" : status === "disabled" ? "disabled" : "set to draft"}.`);
      onChanged();
      await reloadDetail();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to change status");
    } finally {
      setBusy(false);
    }
  };

  const doPreview = async () => {
    if (templateKey === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<TemplatePreview>(`/comm-admin/templates/${encodeURIComponent(templateKey)}/preview`, {
        subject: form.subject,
        bodyText: form.bodyText,
        bodyHtml: form.bodyHtml.trim() ? form.bodyHtml : null,
      });
      setPreview(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to render preview");
    } finally {
      setBusy(false);
    }
  };

  // ---- render --------------------------------------------------------------

  const title = isCreate ? "New template" : tmpl ? tmpl.name : "Template";
  const canCreate =
    form.key.trim().length >= 2 &&
    KEY_RE.test(form.key.trim()) &&
    form.name.trim().length >= 2 &&
    !busy;

  return (
    <Modal open={open} title={title} onClose={onClose}>
      {loading ? (
        <Spinner />
      ) : !isCreate && !tmpl ? (
        <ErrorNote message={error ?? "Template not found."} />
      ) : (
        <div className="space-y-4 text-sm">
          {/* Header meta (edit) */}
          {tmpl && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={templateStatusTone(tmpl.status)}>{titleCase(tmpl.status)}</Badge>
              {tmpl.isBuiltin && <Badge tone="blue">Built-in</Badge>}
              <span className="font-mono text-xs text-faint">{tmpl.key}</span>
              <span className="text-xs text-muted">v{tmpl.version}</span>
            </div>
          )}

          {/* Create-only key field */}
          {isCreate && (
            <Field
              label="Key"
              hint="Lowercase letters, digits and underscores. Cannot be changed later."
              error={form.key.length > 0 && !KEY_RE.test(form.key.trim()) ? "Invalid key format." : undefined}
            >
              <Input value={form.key} onChange={(e) => patch({ key: e.target.value })} placeholder="welcome_email" />
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Template name" />
            </Field>
            <Field label="Category">
              <Select value={form.category} onChange={(e) => patch({ category: e.target.value as TemplateCategory })}>
                {TEMPLATE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {titleCase(c)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Subject">
            <Input
              ref={subjectRef}
              value={form.subject}
              onChange={(e) => patch({ subject: e.target.value })}
              onFocus={() => (lastFocused.current = "subject")}
              placeholder="Subject line"
            />
          </Field>

          {/* Variable picker */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Insert variable</p>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_VARS.map((v) => (
                <button
                  key={v.name}
                  type="button"
                  onClick={() => insertVar(v.name)}
                  title={v.doc}
                  className="rounded-lg border border-line bg-surface-2 px-2 py-1 font-mono text-xs text-muted transition hover:bg-hover hover:text-ink"
                >
                  {`{{${v.name}}}`}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-faint">
              Click a chip to insert it into the last-focused subject or body field. Only these variables resolve;
              anything else is left visible and flagged.
            </p>
          </div>

          <Field label="Body (plain text)">
            <Textarea
              ref={bodyRef}
              rows={6}
              value={form.bodyText}
              onChange={(e) => patch({ bodyText: e.target.value })}
              onFocus={() => (lastFocused.current = "body")}
              placeholder="Email body…"
            />
          </Field>

          <Field label="Body (HTML, optional)" hint="Scripts are stripped server-side.">
            <Textarea
              rows={4}
              value={form.bodyHtml}
              onChange={(e) => patch({ bodyHtml: e.target.value })}
              placeholder="<p>Optional HTML body…</p>"
            />
          </Field>

          <Field label="Description (optional)">
            <Input value={form.description} onChange={(e) => patch({ description: e.target.value })} placeholder="Internal note" />
          </Field>

          {isCreate ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Initial status">
                <Select value={form.status} onChange={(e) => patch({ status: e.target.value as CommTemplateStatus })}>
                  {TEMPLATE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {titleCase(s)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          ) : (
            <Field label="Change note (optional)" hint="Recorded on the new version.">
              <Input value={form.changeNote} onChange={(e) => patch({ changeNote: e.target.value })} placeholder="What changed?" />
            </Field>
          )}

          <ErrorNote message={error} />

          {/* Actions */}
          {isCreate ? (
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={doCreate} disabled={!canCreate}>
                {busy ? "Creating…" : "Create template"}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={doPreview} disabled={busy}>
                  <Icon name="search" className="h-4 w-4" />
                  Preview
                </Button>
                <Button variant="secondary" onClick={() => setPanel(panel === "test" ? "none" : "test")} disabled={busy}>
                  <Icon name="mail" className="h-4 w-4" />
                  Send test
                </Button>
                <Button variant="secondary" onClick={() => setPanel(panel === "versions" ? "none" : "versions")} disabled={busy}>
                  <Icon name="history" className="h-4 w-4" />
                  Versions ({versions.length})
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {tmpl && tmpl.status !== "active" && (
                  <Button variant="secondary" onClick={() => doPublish("active")} disabled={busy}>
                    Publish
                  </Button>
                )}
                {tmpl && tmpl.status !== "disabled" && (
                  <Button variant="danger" onClick={() => doPublish("disabled")} disabled={busy}>
                    Disable
                  </Button>
                )}
                <Button onClick={doSave} disabled={busy}>
                  {busy ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          )}

          {/* Preview panel */}
          {preview && !isCreate && <PreviewPanel preview={preview} onClose={() => setPreview(null)} />}

          {/* Test-send panel */}
          {panel === "test" && templateKey && (
            <TestPanel templateKey={templateKey} onDone={onChanged} />
          )}

          {/* Versions panel */}
          {panel === "versions" && !isCreate && (
            <VersionsPanel
              versions={versions}
              current={{ subject: form.subject, bodyText: form.bodyText }}
              templateKey={templateKey}
              isBuiltin={tmpl?.isBuiltin ?? false}
              onRestored={async () => {
                onChanged();
                await reloadDetail();
              }}
            />
          )}
        </div>
      )}
    </Modal>
  );
}

// ---- preview panel ---------------------------------------------------------

function PreviewPanel({ preview, onClose }: { preview: TemplatePreview; onClose: () => void }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Rendered preview (sample data)</p>
        <button onClick={onClose} className="rounded p-1 text-faint hover:text-ink" aria-label="Close preview">
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>
      <p className="text-sm">
        <span className="font-medium text-ink">Subject:</span> <span className="text-muted">{preview.subject || "—"}</span>
      </p>
      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-surface px-3 py-2 text-xs text-muted">
        {preview.bodyText || "—"}
      </pre>
      {preview.bodyHtml && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-brand-600">HTML body (source)</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-surface px-3 py-2 text-xs text-muted">
            {preview.bodyHtml}
          </pre>
        </details>
      )}
      {preview.warnings.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          {preview.warnings.join(" ")}
        </div>
      )}
    </div>
  );
}

// ---- test-send panel -------------------------------------------------------

function TestPanel({ templateKey, onDone }: { templateKey: string; onDone: () => void }) {
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TestSendResult | null>(null);

  const needsReason = to.trim().length > 0 && !isTestAddress(to);
  const reasonOk = !needsReason || reason.trim().length >= MIN_REASON;
  const canSend = /.+@.+\..+/.test(to.trim()) && reasonOk && !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { to: to.trim() };
      if (reason.trim()) body.reason = reason.trim();
      const res = await api.post<TestSendResult>(`/comm-admin/templates/${encodeURIComponent(templateKey)}/test`, body);
      setResult(res);
      toast.success(`Test ${res.status === "sent" ? "sent" : res.status} to ${to.trim()}.`);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send test");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Send a test of this template</p>
      <div className="space-y-3">
        <Field label="Recipient email">
          <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@example.com" />
        </Field>
        {needsReason && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            External recipient — a reason of at least 5 characters is required and audited.
          </div>
        )}
        <Field
          label={needsReason ? "Reason (min 5 characters)" : "Reason (optional)"}
          error={needsReason && reason.length > 0 && reason.trim().length < MIN_REASON ? "At least 5 characters required." : undefined}
        >
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this test being sent?" />
        </Field>
        {result && (
          <p className="text-xs text-muted">
            Result: <Badge tone={result.status === "failed" ? "red" : result.status === "sent" ? "green" : "slate"}>{titleCase(result.status)}</Badge>
          </p>
        )}
        <ErrorNote message={error} />
        <div className="flex justify-end">
          <Button onClick={submit} disabled={!canSend}>
            {busy ? "Sending…" : "Send test"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---- versions + restore ----------------------------------------------------

function VersionsPanel({
  versions,
  current,
  templateKey,
  isBuiltin,
  onRestored,
}: {
  versions: TemplateVersion[];
  current: { subject: string; bodyText: string };
  templateKey: string | null;
  isBuiltin: boolean;
  onRestored: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sel = versions.find((v) => v.version === selected) ?? null;

  const doRestore = async (version: number) => {
    if (templateKey === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.post<EmailTemplate>(`/comm-admin/templates/${encodeURIComponent(templateKey)}/restore`, {
        version,
        changeNote: reason.trim(),
      });
      toast.success(`Restored from v${version}.`);
      setRestoring(null);
      setReason("");
      onRestored();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to restore version");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Version history (append-only)</p>
      {isBuiltin && (
        <p className="mb-2 text-xs text-faint">Built-in template — it can be edited, disabled and restored, but never deleted.</p>
      )}
      {versions.length === 0 ? (
        <p className="text-sm text-muted">No versions recorded.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {versions.map((v) => (
            <li key={`${v.version}-${v.createdAt}`} className="px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="slate">v{v.version}</Badge>
                  <span className="truncate text-xs text-muted" title={v.subject}>
                    {v.subject || "—"}
                  </span>
                  {v.changeNote && <span className="text-xs text-faint">· {v.changeNote}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-faint">{formatDateTime(v.createdAt)}</span>
                  <button
                    onClick={() => setSelected(selected === v.version ? null : v.version)}
                    className="text-xs font-medium text-brand-600 hover:underline"
                  >
                    {selected === v.version ? "Hide diff" : "Diff"}
                  </button>
                  <button
                    onClick={() => {
                      setRestoring(restoring === v.version ? null : v.version);
                      setReason("");
                      setError(null);
                    }}
                    className="text-xs font-medium text-brand-600 hover:underline"
                  >
                    Restore
                  </button>
                </div>
              </div>

              {selected === v.version && sel && (
                <div className="mt-2 grid gap-2">
                  <DiffBlock title={`Selected · v${v.version}`} subject={sel.subject} body={sel.bodyText} />
                  <DiffBlock title="Current" subject={current.subject} body={current.bodyText} />
                </div>
              )}

              {restoring === v.version && (
                <div className="mt-2 space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Restoring writes a new version from v{v.version}. A reason of at least 5 characters is required and audited.
                  </p>
                  <Textarea
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why restore this version?"
                  />
                  <ErrorNote message={error} />
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => setRestoring(null)} disabled={busy}>
                      Cancel
                    </Button>
                    <Button onClick={() => doRestore(v.version)} disabled={busy || reason.trim().length < MIN_REASON}>
                      {busy ? "Restoring…" : `Restore v${v.version}`}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DiffBlock({ title, subject, body }: { title: string; subject: string; body: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-2">
      <p className="mb-1 text-xs font-semibold text-ink">{title}</p>
      <p className="text-xs text-muted">
        <span className="font-medium">Subject:</span> {subject || "—"}
      </p>
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-faint">{body || "—"}</pre>
    </div>
  );
}
