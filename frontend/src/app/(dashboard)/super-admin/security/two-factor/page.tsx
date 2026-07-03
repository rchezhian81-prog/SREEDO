"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { usePermissions } from "@/lib/use-permissions";
import { usePlatformGuard } from "../../platform/_guard";
import { TwoFaPolicyModal } from "../_modals";
import {
  COMPLIANCE_STATUSES,
  complianceLabel,
  complianceTone,
  formatDate,
  formatDateTime,
  roleLabel,
  roleTone,
  type ComplianceRow,
  type Paged,
  type TwoFaPolicy,
  type TwoFaPolicyRole,
} from "../_security";

export default function TwoFactorPage() {
  const { ready, gate } = usePlatformGuard(
    "2FA enforcement",
    "Per-role two-factor requirements & compliance"
  );
  const { can } = usePermissions();
  const canManage = can("platform:security_manage");

  const [policy, setPolicy] = useState<TwoFaPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [editRole, setEditRole] = useState<TwoFaPolicyRole | null>(null);

  // Compliance list.
  const [rows, setRows] = useState<Paged<ComplianceRow>>({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 25,
  });
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [compLoading, setCompLoading] = useState(true);
  const [compError, setCompError] = useState<string | null>(null);

  const loadPolicy = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      setPolicy(await api.get<TwoFaPolicy>("/platform/security/2fa/policy"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : "Failed to load policy");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) loadPolicy();
  }, [ready, loadPolicy]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [status, debounced]);

  const loadCompliance = useCallback(async () => {
    if (!ready) return;
    setCompLoading(true);
    setCompError(null);
    try {
      const p = new URLSearchParams();
      p.set("status", status);
      if (debounced.trim()) p.set("q", debounced.trim());
      p.set("page", String(page));
      p.set("pageSize", "25");
      setRows(
        await api.get<Paged<ComplianceRow>>(
          `/platform/security/2fa/compliance?${p.toString()}`
        )
      );
    } catch (err) {
      setCompError(err instanceof ApiError ? err.message : "Failed to load compliance");
    } finally {
      setCompLoading(false);
    }
  }, [ready, status, debounced, page]);

  useEffect(() => {
    loadCompliance();
  }, [loadCompliance]);

  const totalPages = Math.max(1, Math.ceil(rows.total / (rows.pageSize || 25)));

  if (!ready) return gate;

  if (forbidden) {
    return (
      <>
        <PageHeader title="2FA enforcement" subtitle="Per-role two-factor requirements & compliance" />
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
        / <span className="text-muted">2FA enforcement</span>
      </nav>
      <PageHeader
        title="2FA enforcement"
        subtitle="Per-role two-factor requirements & compliance"
        action={
          policy && (
            <Badge tone={policy.forcePlatform ? "green" : "slate"}>
              Platform-wide 2FA {policy.forcePlatform ? "enforced" : "off"}
            </Badge>
          )
        }
      />

      <ErrorNote message={error} />

      {/* Per-role policy */}
      {loading ? (
        <Spinner />
      ) : !policy ? null : (
        <Card className="mb-8 p-0">
          <div className="overflow-x-auto rounded-2xl">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Users</th>
                  <th className="px-4 py-3">Without 2FA</th>
                  <th className="px-4 py-3">Require 2FA</th>
                  <th className="px-4 py-3">Grace until</th>
                  <th className="px-4 py-3">Last updated</th>
                  {canManage && <th className="px-4 py-3 text-right">Edit</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {policy.roles.map((r) => (
                  <tr key={r.roleKey} className="hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <span className="font-medium text-ink">{r.name}</span>
                      {r.isOwner && (
                        <span className="ml-2 align-middle">
                          <Badge tone="blue">owner</Badge>
                        </span>
                      )}
                      <span className="block font-mono text-xs text-faint">
                        {r.roleKey}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink">{r.usersInRole}</td>
                    <td className="px-4 py-3">
                      {r.usersWithout2fa > 0 ? (
                        <Badge tone="amber">{r.usersWithout2fa}</Badge>
                      ) : (
                        <span className="text-faint">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={r.require2fa}
                        disabled={!canManage}
                        onClick={() => canManage && setEditRole(r)}
                        title={
                          canManage
                            ? undefined
                            : "Requires platform:security_manage"
                        }
                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          r.require2fa ? "bg-brand-600" : "bg-hover"
                        }`}
                      >
                        <span
                          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                            r.require2fa ? "translate-x-5" : "translate-x-0.5"
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {r.require2fa ? formatDate(r.graceUntil) : "—"}
                    </td>
                    <td className="px-4 py-3 text-faint">
                      {r.updatedByEmail ? (
                        <span>
                          {r.updatedByEmail}
                          <span className="block text-xs">
                            {formatDateTime(r.updatedAt)}
                          </span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" onClick={() => setEditRole(r)}>
                          <Icon name="wrench" className="h-4 w-4" />
                          Edit
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Compliance */}
      <h2 className="mb-3 text-lg font-bold text-ink">User compliance</h2>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <label className="mb-1.5 block text-sm font-medium text-ink">Search</label>
          <Input
            placeholder="Name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-52">
          <label className="mb-1.5 block text-sm font-medium text-ink">State</label>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {COMPLIANCE_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <ErrorNote message={compError} />

      {compLoading ? (
        <Spinner />
      ) : rows.rows.length === 0 ? (
        <EmptyState message="No users match these filters." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">2FA</th>
                  <th className="px-4 py-3">Grace until</th>
                  <th className="px-4 py-3">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.rows.map((u) => (
                  <tr key={u.id} className="hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <Link
                        href={`/super-admin/admins/${u.id}`}
                        className="font-medium text-ink hover:text-brand-600"
                      >
                        {u.fullName}
                      </Link>
                      {u.isOwner && (
                        <span className="ml-2 align-middle">
                          <Badge tone="blue">owner</Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">{u.email}</td>
                    <td className="px-4 py-3">
                      <Badge tone={roleTone(u.platformRole)}>
                        {roleLabel(u.platformRole)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={u.twoFactorEnabled ? "green" : "amber"}>
                        {u.twoFactorEnabled ? "On" : "Off"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted">{formatDate(u.graceUntil)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={complianceTone(u.state)}>
                        {complianceLabel(u.state)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-muted">
            <span>
              {rows.total} user{rows.total === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                ← Prev
              </Button>
              <span>
                Page {rows.page} of {totalPages}
              </span>
              <Button
                variant="secondary"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages}
              >
                Next →
              </Button>
            </div>
          </div>
        </>
      )}

      <TwoFaPolicyModal
        role={editRole}
        onClose={() => setEditRole(null)}
        onSaved={(p) => {
          setPolicy(p);
          loadCompliance();
        }}
      />
    </>
  );
}
