"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { Button, Card, ErrorNote, Input, PageHeader, Spinner } from "@/components/ui";

// Clean settings hub. The legacy per-tenant school/college-only editor (with
// comma-separated module entry) is retired — tenant configuration now lives in
// each tenant's detail (one common module), and platform settings are linked here.
interface TenantRow { id: string; name: string; code: string; institutionType: string; status: string }
interface Paged { rows: TenantRow[]; total: number }

export default function SuperAdminSettingsPage() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const p = new URLSearchParams({ pageSize: "25", sort: "name", order: "asc" });
        if (q.trim()) p.set("q", q.trim());
        const data = await api.get<Paged>(`/platform/tenants?${p.toString()}`);
        setRows(data.rows);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Failed to load tenants");
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Tenant configuration lives inside each tenant (one common module); platform-wide settings are linked below."
      />
      <Card className="mb-4">
        <p className="mb-2 text-sm font-medium text-slate-700">Platform settings</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/super-admin/invoices/settings"><Button variant="secondary">Invoice settings</Button></Link>
          <Link href="/super-admin/rbac"><Button variant="secondary">Roles &amp; permissions</Button></Link>
          <Link href="/super-admin/packages"><Button variant="secondary">Packages</Button></Link>
          <Link href="/super-admin/backups"><Button variant="secondary">Backups</Button></Link>
          <Link href="/super-admin/health"><Button variant="secondary">System health</Button></Link>
        </div>
      </Card>
      <Card>
        <p className="mb-1 text-sm font-medium text-slate-700">Tenant settings</p>
        <p className="mb-3 text-xs text-slate-400">
          Pick a tenant to edit its profile, type-based settings, modules (proper toggles — no comma-separated
          lists), branding, documents and more.
        </p>
        <Input placeholder="Search tenant by name / code / email…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" />
        {error && <ErrorNote message={error} />}
        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-400">No tenants found.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  <span className="font-medium text-slate-900">{t.name}</span>{" "}
                  <span className="font-mono text-xs text-slate-500">{t.code}</span>{" "}
                  <span className="capitalize text-slate-400">· {t.institutionType} · {t.status}</span>
                </span>
                <Link href={`/super-admin/platform/tenants/${t.id}`} className="text-xs font-medium text-brand-600 hover:text-brand-700">
                  Open settings →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
