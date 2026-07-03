"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import { toast } from "@/components/toast";
import { Icon } from "@/components/icons";
import { usePermissions } from "@/lib/use-permissions";
import { usePlatformGuard } from "../../platform/_guard";
import { LockAccountModal, ReasonModal } from "../_modals";
import {
  formatDateTime,
  roleLabel,
  roleTone,
  type LockedAccount,
} from "../_security";

export default function LockedAccountsPage() {
  const { ready, gate } = usePlatformGuard(
    "Locked accounts",
    "Currently locked platform accounts"
  );
  const { can } = usePermissions();
  const canManage = can("platform:security_manage");

  const [rows, setRows] = useState<LockedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [unlockTarget, setUnlockTarget] = useState<LockedAccount | null>(null);
  const [showLock, setShowLock] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      setRows(await api.get<LockedAccount[]>("/platform/security/locked-accounts"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : "Failed to load locked accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const unlock = async (reason: string) => {
    if (!unlockTarget) return;
    await api.post(`/platform/security/users/${unlockTarget.id}/unlock`, { reason });
    toast.success(`Unlocked ${unlockTarget.fullName}`);
    load();
  };

  if (!ready) return gate;

  if (forbidden) {
    return (
      <>
        <PageHeader title="Locked accounts" subtitle="Currently locked platform accounts" />
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
        / <span className="text-muted">Locked accounts</span>
      </nav>
      <PageHeader
        title="Locked accounts"
        subtitle="Currently locked platform accounts"
        action={
          canManage && (
            <Button variant="danger" onClick={() => setShowLock(true)}>
              <Icon name="lock" className="h-4 w-4" />
              Lock an account
            </Button>
          )
        }
      />

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No locked accounts." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Lock reason</th>
                <th className="px-4 py-3 text-right">Failed attempts</th>
                <th className="px-4 py-3">Locked until</th>
                <th className="px-4 py-3">Last login</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((a) => (
                <tr key={a.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <Link
                      href={`/super-admin/admins/${a.id}`}
                      className="font-medium text-ink hover:text-brand-600"
                    >
                      {a.fullName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted">{a.email}</td>
                  <td className="px-4 py-3">
                    <Badge tone={roleTone(a.platformRole)}>
                      {roleLabel(a.platformRole)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={a.manualLock ? "red" : "amber"}>
                      {a.manualLock ? "Manual lock" : "Failed attempts"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right text-ink">
                    {a.failedLoginAttempts}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">
                    {a.manualLock ? "Indefinite" : formatDateTime(a.lockedUntil)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">
                    {formatDateTime(a.lastLoginAt)}
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" onClick={() => setUnlockTarget(a)}>
                        Unlock
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ReasonModal
        open={!!unlockTarget}
        title="Unlock account"
        cta="Unlock"
        description={
          unlockTarget && (
            <>
              Unlock{" "}
              <span className="font-medium text-ink">{unlockTarget.fullName}</span>{" "}
              and allow them to sign in again?
            </>
          )
        }
        onSubmit={unlock}
        onClose={() => setUnlockTarget(null)}
      />

      <LockAccountModal
        open={showLock}
        onClose={() => setShowLock(false)}
        onLocked={load}
      />
    </>
  );
}
