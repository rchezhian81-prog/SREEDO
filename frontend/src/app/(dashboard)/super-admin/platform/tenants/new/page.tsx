"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Button, Card, ErrorNote, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { usePlatformGuard } from "../../_guard";

const TYPES = ["school", "college", "university", "coaching", "other"] as const;

export default function NewTenantPage() {
  const { ready, gate } = usePlatformGuard("New tenant", "Onboard an institution");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    name: "", code: "", institutionType: "school", legalName: "", shortName: "",
    email: "", phone: "", website: "", address: "", city: "", state: "", country: "India",
    pincode: "", academicYear: "", currency: "INR", language: "", notes: "",
    adminName: "", adminEmail: "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  const create = async () => {
    setError(null);
    if (!f.name.trim() || f.code.trim().length < 2) {
      setError("Name and a code (min 2 chars) are required");
      return;
    }
    setBusy(true);
    try {
      const blank = (v: string) => (v.trim() === "" ? undefined : v.trim());
      const body: Record<string, unknown> = {
        name: f.name.trim(), code: f.code.trim(), institutionType: f.institutionType,
        legalName: blank(f.legalName), shortName: blank(f.shortName), email: blank(f.email),
        phone: blank(f.phone), website: blank(f.website), address: blank(f.address),
        city: blank(f.city), state: blank(f.state), country: blank(f.country),
        pincode: blank(f.pincode), academicYear: blank(f.academicYear),
        currency: blank(f.currency), language: blank(f.language), notes: blank(f.notes),
      };
      if (f.adminName.trim() && f.adminEmail.trim()) {
        body.primaryAdmin = { fullName: f.adminName.trim(), email: f.adminEmail.trim() };
      }
      const created = await api.post<{ id: string }>("/platform/tenants", body);
      router.push(`/super-admin/platform/tenants/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create tenant");
      setBusy(false);
    }
  };

  if (!ready) return gate;

  return (
    <>
      <nav className="mb-2 text-xs text-slate-400">
        <Link href="/super-admin/platform/tenants" className="hover:text-slate-600">Tenants</Link> /{" "}
        <span className="text-slate-600">New</span>
      </nav>
      <PageHeader
        title="New tenant"
        subtitle="One common module — pick a type; structure & settings are configured after creation"
        action={<Link href="/super-admin/platform/tenants"><Button variant="secondary">← Back</Button></Link>}
      />
      {error && <ErrorNote message={error} />}

      <Card className="mb-4">
        <p className="mb-3 text-sm font-medium text-slate-700">Identity</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Institution name *"><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Code * (unique)"><Input value={f.code} onChange={(e) => set("code", e.target.value)} /></Field>
          <Field label="Institution type *">
            <Select value={f.institutionType} onChange={(e) => set("institutionType", e.target.value)}>
              {TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
            </Select>
          </Field>
          <Field label="Legal / registered name"><Input value={f.legalName} onChange={(e) => set("legalName", e.target.value)} /></Field>
          <Field label="Short / display name"><Input value={f.shortName} onChange={(e) => set("shortName", e.target.value)} /></Field>
          <Field label="Academic year"><Input placeholder="2026-2027" value={f.academicYear} onChange={(e) => set("academicYear", e.target.value)} /></Field>
        </div>
      </Card>

      <Card className="mb-4">
        <p className="mb-3 text-sm font-medium text-slate-700">Contact & location</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email"><Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Website"><Input value={f.website} onChange={(e) => set("website", e.target.value)} /></Field>
          <Field label="City"><Input value={f.city} onChange={(e) => set("city", e.target.value)} /></Field>
          <Field label="State"><Input value={f.state} onChange={(e) => set("state", e.target.value)} /></Field>
          <Field label="Country"><Input value={f.country} onChange={(e) => set("country", e.target.value)} /></Field>
          <Field label="PIN / postal code"><Input value={f.pincode} onChange={(e) => set("pincode", e.target.value)} /></Field>
          <Field label="Currency"><Input value={f.currency} onChange={(e) => set("currency", e.target.value)} /></Field>
        </div>
        <div className="mt-3"><Field label="Address"><Textarea rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} /></Field></div>
      </Card>

      <Card className="mb-4">
        <p className="mb-1 text-sm font-medium text-slate-700">Primary admin (optional)</p>
        <p className="mb-3 text-xs text-slate-400">Creates the tenant admin with a secure random password; they set their own via password reset. No default password is exposed.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Admin name"><Input value={f.adminName} onChange={(e) => set("adminName", e.target.value)} /></Field>
          <Field label="Admin email"><Input type="email" value={f.adminEmail} onChange={(e) => set("adminEmail", e.target.value)} /></Field>
        </div>
      </Card>

      <div className="flex justify-end gap-2">
        <Link href="/super-admin/platform/tenants"><Button variant="secondary">Cancel</Button></Link>
        <Button onClick={create} disabled={busy}>{busy ? "Creating…" : "Create tenant"}</Button>
      </div>
    </>
  );
}
