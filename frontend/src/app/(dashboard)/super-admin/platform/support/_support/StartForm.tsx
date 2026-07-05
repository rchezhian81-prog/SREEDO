"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorNote,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import { useAuthStore } from "@/stores/auth-store";
import type {
  PlatformUserSearchRow,
  SupportApproval,
  SupportApprovalPage,
  SupportScope,
  SupportStartResult,
  SupportTemplates,
} from "@/types";
import { formatDateTime, moduleLabel, scopeLabel, scopeTone, templateLabel } from "./taxonomy";
import { ScopeSelector } from "./ScopeSelector";

const MIN_RISK = 5;

const MIN_REASON = 8;

// Client-side default sentences a reason template prefills into the reason box.
// The template KEYS come from the backend (/templates); these are just helpful
// starting text the operator can edit.
const TEMPLATE_REASONS: Record<string, string> = {
  bug_investigation: "Investigating a reported bug affecting this tenant.",
  tenant_request: "Assisting with a support request raised by the tenant.",
  billing_support: "Reviewing a billing or invoice issue for this tenant.",
  data_correction: "Applying an approved data correction for this tenant.",
  training_demo: "Providing a training / demo walkthrough for this tenant.",
  technical_troubleshooting: "Troubleshooting a technical issue reported by this tenant.",
  security_review: "Conducting a security review for this tenant.",
  other: "",
};

const EXPIRY_PRESETS = ["15", "30", "60"] as const;

export function StartForm({ templates }: { templates: SupportTemplates | null }) {
  const router = useRouter();
  const enterSupport = useAuthStore((s) => s.enterSupport);
  const operatorEmail = useAuthStore((s) => s.user?.email ?? "");
  const operatorId = useAuthStore((s) => s.user?.id ?? "");

  const [q, setQ] = useState("");
  const [results, setResults] = useState<PlatformUserSearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<PlatformUserSearchRow | null>(null);

  const [reason, setReason] = useState("");
  const [reasonTemplate, setReasonTemplate] = useState("");
  const [scope, setScope] = useState<SupportScope>("read_only");
  const [modules, setModules] = useState<string[]>([]);
  const [expiryMode, setExpiryMode] = useState<string>("30");
  const [customExpiry, setCustomExpiry] = useState(30);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phase 2 (L): a write-enabled start requires a matching APPROVED, unconsumed
  // approval request by this operator for this target. We resolve the operator's
  // usable/pending approvals for the selected target to drive the start gate.
  const [approvals, setApprovals] = useState<SupportApproval[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<SupportApproval[]>([]);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [selectedApprovalId, setSelectedApprovalId] = useState("");
  const [riskReason, setRiskReason] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const scopes = templates?.scopes ?? ["read_only", "write_enabled", "module_limited"];
  const moduleKeys = templates?.modules ?? [];
  const expiryMinutes = expiryMode === "custom" ? customExpiry : Number(expiryMode);

  const search = useCallback(async (term: string) => {
    if (!term.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      setResults(
        await api.get<PlatformUserSearchRow[]>(
          `/platform/users?q=${encodeURIComponent(term.trim())}&limit=20`
        )
      );
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(q), 300);
    return () => clearTimeout(t);
  }, [q, search]);

  // Resolve THIS operator's approvals for the SELECTED target — the same match the
  // server's start gate enforces (requester + target + write_enabled + unconsumed).
  const loadApprovals = useCallback(async () => {
    if (scope !== "write_enabled" || !selected || !operatorId) {
      setApprovals([]);
      setPendingApprovals([]);
      return;
    }
    setApprovalsLoading(true);
    try {
      const [approved, pending] = await Promise.all([
        api.get<SupportApprovalPage>("/platform/support/approvals?status=approved&pageSize=200"),
        api.get<SupportApprovalPage>("/platform/support/approvals?status=pending&pageSize=200"),
      ]);
      const mine = (a: SupportApproval) =>
        a.targetId === selected.id && a.requestedBy === operatorId && a.scope === "write_enabled";
      const usable = approved.rows.filter((a) => mine(a) && !a.consumedAt);
      setApprovals(usable);
      setPendingApprovals(pending.rows.filter(mine));
      setSelectedApprovalId((cur) => (usable.some((a) => a.id === cur) ? cur : usable[0]?.id ?? ""));
    } catch {
      setApprovals([]);
      setPendingApprovals([]);
    } finally {
      setApprovalsLoading(false);
    }
  }, [scope, selected, operatorId]);

  useEffect(() => {
    loadApprovals();
  }, [loadApprovals]);

  const requestApproval = async () => {
    if (!selected) return;
    setApprovalError(null);
    if (reason.trim().length < MIN_REASON) {
      setApprovalError(`Enter a reason of at least ${MIN_REASON} characters above.`);
      return;
    }
    if (riskReason.trim().length < MIN_RISK) {
      setApprovalError(`Enter a risk justification of at least ${MIN_RISK} characters.`);
      return;
    }
    setRequesting(true);
    try {
      await api.post<SupportApproval>("/platform/support/approvals", {
        userId: selected.id,
        reason: reason.trim(),
        reasonTemplate: reasonTemplate || undefined,
        scope: "write_enabled",
        expiryMinutes,
        riskReason: riskReason.trim(),
      });
      toast.success("Approval requested. An approver must approve it before you can start.");
      setRiskReason("");
      await loadApprovals();
    } catch (err) {
      setApprovalError(err instanceof ApiError ? err.message : "Failed to request approval");
    } finally {
      setRequesting(false);
    }
  };

  const onTemplate = (value: string) => {
    setReasonTemplate(value);
    const prefill = TEMPLATE_REASONS[value];
    // Prefill only when there's a suggestion and the operator hasn't typed their
    // own reason yet (never clobber real input).
    if (prefill && reason.trim() === "") setReason(prefill);
  };

  const reasonValid = reason.trim().length >= MIN_REASON;
  const modulesValid = scope !== "module_limited" || modules.length > 0;
  const expiryValid = expiryMinutes >= 5 && expiryMinutes <= 120;
  // A write-enabled start is gated on a usable (approved, unconsumed) approval.
  const needsApproval = scope === "write_enabled";
  const hasUsableApproval = approvals.length > 0 && !!selectedApprovalId;
  const approvalOk = !needsApproval || hasUsableApproval;
  const canSubmit = !!selected && reasonValid && modulesValid && expiryValid && approvalOk;

  const openConfirm = () => {
    setError(null);
    if (!selected) return setError("Select a tenant user to support.");
    if (!reasonValid) return setError(`Enter a reason of at least ${MIN_REASON} characters.`);
    if (!modulesValid) return setError("Select at least one module for a module-limited session.");
    if (!expiryValid) return setError("Expiry must be between 5 and 120 minutes.");
    if (needsApproval && !hasUsableApproval) {
      return setError("A write-enabled session requires an approved request. Request approval below.");
    }
    setConfirmOpen(true);
  };

  const start = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<SupportStartResult>("/platform/support/sessions", {
        userId: selected.id,
        reason: reason.trim(),
        reasonTemplate: reasonTemplate || undefined,
        scope,
        modules: scope === "module_limited" ? modules : undefined,
        expiryMinutes,
        approvalId: scope === "write_enabled" ? selectedApprovalId : undefined,
      });

      // Enter REAL support mode: swap identity to the target's scoped token and
      // stash the operator's own session so we can end/return later.
      enterSupport({
        token: result.token,
        user: {
          id: result.user.id,
          email: result.user.email,
          fullName: result.user.fullName,
          role: result.user.role,
          institutionId: result.user.institutionId,
        },
        session: {
          id: result.session.id,
          targetId: result.user.id,
          targetEmail: result.user.email,
          targetRole: result.user.role,
          targetName: result.user.fullName,
          institutionId: result.user.institutionId,
          institutionName: selected.institutionName,
          institutionCode: selected.institutionCode,
          scope: result.session.scope,
          allowedModules: result.session.allowedModules,
          reason: reason.trim(),
          reasonTemplate: reasonTemplate || null,
          operatorEmail,
          expiresAt: result.session.expiresAt,
        },
      });
      setConfirmOpen(false);
      router.replace("/dashboard");
    } catch (err) {
      setConfirmOpen(false);
      setError(
        err instanceof ApiError
          ? err.status === 409
            ? "You already have an active support session. End it from the Active tab first."
            : err.message
          : "Failed to start support session"
      );
      // The approval may have been consumed/revoked between load and start — resync.
      if (scope === "write_enabled") await loadApprovals();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* Left: pick the user */}
      <Card>
        <p className="mb-3 text-sm font-semibold text-ink">1 · Choose a tenant user</p>
        <Field label="Search by name or email">
          <Input
            placeholder="e.g. jane@school.edu"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSelected(null);
            }}
          />
        </Field>

        {!selected && q.trim() && (
          <div className="mt-3 rounded-xl border border-line">
            {searching ? (
              <div className="p-3">
                <Spinner />
              </div>
            ) : results.length === 0 ? (
              <p className="p-3 text-sm text-faint">No matching tenant users.</p>
            ) : (
              <ul className="max-h-72 divide-y divide-line overflow-y-auto">
                {results.map((u) => (
                  <li key={u.id}>
                    <button
                      onClick={() => setSelected(u)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-hover"
                    >
                      <span className="min-w-0">
                        <span className="font-medium text-ink">{u.fullName}</span>{" "}
                        <span className="text-muted">{u.email}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-faint">
                        <Badge tone="slate">{u.role}</Badge>
                        {!u.isActive && <Badge tone="red">inactive</Badge>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {selected && (
          <div className="mt-3 rounded-xl border border-brand-500/40 bg-brand-500/5 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">{selected.fullName}</p>
                <p className="truncate text-sm text-muted">{selected.email}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge tone="slate">{selected.role}</Badge>
                  <span>
                    {selected.institutionName} ({selected.institutionCode})
                  </span>
                  {!selected.isActive && <Badge tone="red">inactive</Badge>}
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="shrink-0 text-xs font-medium text-muted hover:text-ink"
              >
                Change
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* Right: scope the session */}
      <Card>
        <p className="mb-3 text-sm font-semibold text-ink">2 · Scope &amp; reason</p>
        <div className="space-y-4">
          <Field label="Reason (min 8 characters)">
            <Textarea
              rows={2}
              placeholder="Why is this access needed? Include a ticket reference where possible."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {reason.length > 0 && !reasonValid && (
            <p className="-mt-2 text-xs text-red-500">Please enter at least {MIN_REASON} characters.</p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reason template">
              <Select value={reasonTemplate} onChange={(e) => onTemplate(e.target.value)}>
                <option value="">None</option>
                {(templates?.templates ?? []).map((t) => (
                  <option key={t} value={t}>
                    {templateLabel(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Session expiry">
              <Select value={expiryMode} onChange={(e) => setExpiryMode(e.target.value)}>
                {EXPIRY_PRESETS.map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </Select>
            </Field>
          </div>
          {expiryMode === "custom" && (
            <Field label="Custom expiry (5–120 minutes)" error={!expiryValid ? "Enter 5 to 120 minutes." : undefined}>
              <Input
                type="number"
                min={5}
                max={120}
                value={customExpiry}
                onChange={(e) => setCustomExpiry(Number(e.target.value))}
              />
            </Field>
          )}

          <ScopeSelector
            scopes={scopes}
            modules={moduleKeys}
            scope={scope}
            selectedModules={modules}
            onScopeChange={setScope}
            onModulesChange={setModules}
          />

          {scope === "write_enabled" && (
            <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Icon name="lock" className="h-4 w-4 text-amber-600" />
                Approval required
              </p>
              {!selected ? (
                <p className="text-xs text-muted">Choose a tenant user first.</p>
              ) : approvalsLoading ? (
                <Spinner />
              ) : hasUsableApproval ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-emerald-600">
                    Approved — this session will start against the request below.
                  </p>
                  {approvals.length > 1 && (
                    <Field label="Use approval">
                      <Select
                        value={selectedApprovalId}
                        onChange={(e) => setSelectedApprovalId(e.target.value)}
                      >
                        {approvals.map((a) => (
                          <option key={a.id} value={a.id}>
                            Approved {formatDateTime(a.decidedAt)}
                            {a.riskReason ? ` · ${a.riskReason.slice(0, 40)}` : ""}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                </div>
              ) : pendingApprovals.length > 0 ? (
                <p className="text-xs text-amber-600">
                  You have a pending approval request for this user. Start stays disabled until an
                  approver approves it (see the Approvals tab).
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted">
                    A write-enabled session needs a pre-approved request. Add a risk justification, then
                    request approval.
                  </p>
                  <Field label={`Risk justification (min ${MIN_RISK} characters)`}>
                    <Textarea
                      rows={2}
                      placeholder="Why is full write access needed? What is the risk and mitigation?"
                      value={riskReason}
                      onChange={(e) => setRiskReason(e.target.value)}
                    />
                  </Field>
                  <ErrorNote message={approvalError} />
                  <Button
                    variant="secondary"
                    onClick={requestApproval}
                    disabled={requesting || !reasonValid || riskReason.trim().length < MIN_RISK}
                  >
                    {requesting ? "Requesting…" : "Request approval"}
                  </Button>
                </div>
              )}
            </div>
          )}

          <ErrorNote message={error} />

          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-faint">
              A scoped token is issued as the target user; no passwords or secrets are ever exposed.
              Every start, end and revoke is audited.
            </p>
            <Button onClick={openConfirm} disabled={!canSubmit || busy} className="shrink-0">
              <Icon name="help" className="h-4 w-4" />
              Start session
            </Button>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Start support session?"
        tone="primary"
        confirmLabel="Enter support mode"
        busy={busy}
        onConfirm={start}
        onClose={() => setConfirmOpen(false)}
        message={
          selected ? (
            <div className="space-y-2 text-sm">
              <p>
                You are about to act <strong>as</strong> this tenant user in a live, audited session:
              </p>
              <dl className="space-y-1.5 rounded-xl border border-line bg-surface-2 p-3">
                <Summary label="User" value={`${selected.fullName} · ${selected.email}`} />
                <Summary label="Tenant" value={`${selected.institutionName} (${selected.institutionCode})`} />
                <Summary
                  label="Scope"
                  value={
                    <span className="inline-flex items-center gap-2">
                      <Badge tone={scopeTone(scope)}>{scopeLabel(scope)}</Badge>
                      {scope === "module_limited" && (
                        <span className="text-xs text-muted">
                          {modules.map((m) => moduleLabel(m)).join(", ") || "—"}
                        </span>
                      )}
                    </span>
                  }
                />
                <Summary label="Expiry" value={`${expiryMinutes} minutes`} />
                {reasonTemplate && <Summary label="Template" value={templateLabel(reasonTemplate)} />}
                <Summary label="Reason" value={reason.trim()} />
              </dl>
            </div>
          ) : null
        }
      />
    </div>
  );
}

function Summary({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 font-medium text-muted">{label}</dt>
      <dd className="min-w-0 text-ink">{value}</dd>
    </div>
  );
}
