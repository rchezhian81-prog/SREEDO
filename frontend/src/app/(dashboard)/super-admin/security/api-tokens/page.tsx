"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import { toast } from "@/components/toast";
import { Icon } from "@/components/icons";
import { usePermissions } from "@/lib/use-permissions";
import { usePlatformGuard } from "../../platform/_guard";
import { CreateApiTokenModal, TokenRevealModal } from "../_modals";
import {
  formatDateTime,
  tokenStatusTone,
  type ApiToken,
  type TokenReveal,
} from "../_security";

export default function ApiTokensPage() {
  const { ready, gate } = usePlatformGuard(
    "API tokens",
    "Platform API tokens — create, rotate & revoke"
  );
  const { can } = usePermissions();
  const canManage = can("platform:security_manage");

  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [reveal, setReveal] = useState<TokenReveal | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiToken | null>(null);
  const [rotateTarget, setRotateTarget] = useState<ApiToken | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      setTokens(await api.get<ApiToken[]>("/platform/security/api-tokens"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : "Failed to load tokens");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const revoke = async () => {
    if (!revokeTarget) return;
    setBusy(true);
    try {
      await api.post(`/platform/security/api-tokens/${revokeTarget.id}/revoke`);
      toast.success(`Token "${revokeTarget.name}" revoked`);
      setRevokeTarget(null);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to revoke token");
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    if (!rotateTarget) return;
    setBusy(true);
    try {
      const r = await api.post<TokenReveal>(
        `/platform/security/api-tokens/${rotateTarget.id}/rotate`
      );
      toast.success(`Token "${rotateTarget.name}" rotated`);
      setRotateTarget(null);
      setReveal(r);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to rotate token");
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return gate;

  if (forbidden) {
    return (
      <>
        <PageHeader title="API tokens" subtitle="Platform API tokens — create, rotate & revoke" />
        <EmptyState message="You don't have permission to view this." />
      </>
    );
  }

  return (
    <>
      <nav className="mb-2 text-xs text-faint">
        <Link href="/super-admin/security" className="hover:text-muted">
          Security Center
        </Link>{" "}
        / <span className="text-muted">API tokens</span>
      </nav>
      <PageHeader
        title="API tokens"
        subtitle="Platform API tokens — create, rotate & revoke"
        action={
          canManage && (
            <Button onClick={() => setShowCreate(true)}>
              <Icon name="plus" className="h-4 w-4" />
              Create token
            </Button>
          )
        }
      />

      <div className="mb-4 rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-2 text-sm text-brand-600 dark:text-brand-300">
        Token values are shown once on create/rotate and never stored in a
        recoverable form. Lists only ever show the token prefix.
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : tokens.length === 0 ? (
        <EmptyState message="No API tokens yet." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Prefix</th>
                <th className="px-4 py-3">Scopes</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created by</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Last used</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tokens.map((t) => (
                <tr key={t.id} className="align-top hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <span className="font-medium text-ink">{t.name}</span>
                    {t.description && (
                      <span className="block text-xs text-faint">{t.description}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-muted">{t.tokenPrefix}…</span>
                  </td>
                  <td className="px-4 py-3">
                    {t.scopes.length === 0 ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {t.scopes.map((s) => (
                          <span
                            key={s}
                            className="rounded bg-hover px-1.5 py-0.5 font-mono text-[11px] text-muted"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={tokenStatusTone(t.status)}>{t.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-faint">{t.createdByEmail ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">
                    {t.expiresAt ? formatDateTime(t.expiresAt) : "Never"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">
                    {t.lastUsedAt ? formatDateTime(t.lastUsedAt) : "Never"}
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      {t.status === "active" ? (
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" onClick={() => setRotateTarget(t)}>
                            Rotate
                          </Button>
                          <Button variant="ghost" onClick={() => setRevokeTarget(t)}>
                            Revoke
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-faint">—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateApiTokenModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(r) => {
          setReveal(r);
          load();
        }}
      />

      <TokenRevealModal reveal={reveal} onClose={() => setReveal(null)} />

      <ConfirmDialog
        open={!!revokeTarget}
        title="Revoke API token"
        message={
          revokeTarget
            ? `Revoke "${revokeTarget.name}"? Any client using it will immediately lose access. This cannot be undone.`
            : ""
        }
        confirmLabel="Revoke token"
        busy={busy}
        onConfirm={revoke}
        onClose={() => setRevokeTarget(null)}
      />

      <ConfirmDialog
        open={!!rotateTarget}
        title="Rotate API token"
        message={
          rotateTarget
            ? `Rotate "${rotateTarget.name}"? The current token is revoked immediately and a new value is issued — shown once. Update any clients afterwards.`
            : ""
        }
        confirmLabel="Rotate token"
        tone="primary"
        busy={busy}
        onConfirm={rotate}
        onClose={() => setRotateTarget(null)}
      />
    </>
  );
}
