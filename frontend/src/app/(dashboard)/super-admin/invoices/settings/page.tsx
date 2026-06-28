"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import {
  Button,
  Card,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Spinner,
  Textarea,
} from "@/components/ui";

interface Settings {
  prefix: string;
  fyStartMonth: number;
  numberPadding: number;
  nextInvoiceNumber: number;
  defaultCurrency: string;
  defaultTaxPercent: string;
  defaultSac: string | null;
  defaultDueDays: number | null;
  supplierLegalName: string | null;
  supplierTradeName: string | null;
  supplierAddress: string | null;
  supplierGstin: string | null;
  supplierPan: string | null;
  supplierState: string | null;
  supplierStateCode: string | null;
  supplierEmail: string | null;
  supplierPhone: string | null;
  bankDetails: string | null;
  upiId: string | null;
  pdfFooter: string | null;
  pdfTerms: string | null;
  signatoryName: string | null;
  logoPath: string | null;
}

type FormState = Record<string, string>;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export default function InvoiceSettingsPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await api.get<Settings>("/platform/invoice-settings");
        setForm({
          prefix: str(s.prefix),
          fyStartMonth: str(s.fyStartMonth),
          numberPadding: str(s.numberPadding),
          nextInvoiceNumber: str(s.nextInvoiceNumber),
          defaultCurrency: str(s.defaultCurrency),
          defaultTaxPercent: str(s.defaultTaxPercent),
          defaultSac: str(s.defaultSac),
          defaultDueDays: str(s.defaultDueDays),
          supplierLegalName: str(s.supplierLegalName),
          supplierTradeName: str(s.supplierTradeName),
          supplierAddress: str(s.supplierAddress),
          supplierGstin: str(s.supplierGstin),
          supplierPan: str(s.supplierPan),
          supplierState: str(s.supplierState),
          supplierStateCode: str(s.supplierStateCode),
          supplierEmail: str(s.supplierEmail),
          supplierPhone: str(s.supplierPhone),
          bankDetails: str(s.bankDetails),
          upiId: str(s.upiId),
          pdfFooter: str(s.pdfFooter),
          pdfTerms: str(s.pdfTerms),
          signatoryName: str(s.signatoryName),
          logoPath: str(s.logoPath),
        });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load settings");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = (k: string, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const blank = (v: string) => (v.trim() === "" ? null : v.trim());
      await api.patch("/platform/invoice-settings", {
        prefix: form.prefix || "SINV-",
        fyStartMonth: Number(form.fyStartMonth) || 4,
        numberPadding: Number(form.numberPadding) || 6,
        nextInvoiceNumber: form.nextInvoiceNumber ? Number(form.nextInvoiceNumber) : undefined,
        defaultCurrency: form.defaultCurrency || "INR",
        defaultTaxPercent: Number(form.defaultTaxPercent) || 0,
        defaultSac: blank(form.defaultSac),
        defaultDueDays: form.defaultDueDays ? Number(form.defaultDueDays) : null,
        supplierLegalName: blank(form.supplierLegalName),
        supplierTradeName: blank(form.supplierTradeName),
        supplierAddress: blank(form.supplierAddress),
        supplierGstin: blank(form.supplierGstin),
        supplierPan: blank(form.supplierPan),
        supplierState: blank(form.supplierState),
        supplierStateCode: blank(form.supplierStateCode),
        supplierEmail: blank(form.supplierEmail),
        supplierPhone: blank(form.supplierPhone),
        bankDetails: blank(form.bankDetails),
        upiId: blank(form.upiId),
        pdfFooter: blank(form.pdfFooter),
        pdfTerms: blank(form.pdfTerms),
        signatoryName: blank(form.signatoryName),
        logoPath: blank(form.logoPath),
      });
      setNotice("Settings saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;
  if (!form) return <ErrorNote message={error ?? "Settings unavailable"} />;

  return (
    <>
      <PageHeader
        title="Invoice settings"
        subtitle="Supplier profile, numbering, billing defaults, bank & PDF presentation"
        action={
          <Button variant="secondary" onClick={() => router.push("/super-admin/invoices")}>
            ← Back
          </Button>
        }
      />

      {error && <ErrorNote message={error} />}
      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          {notice}
        </div>
      )}

      <Card className="mb-4">
        <p className="mb-3 text-sm font-medium text-ink">Supplier profile (printed on the PDF)</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Legal name">
            <Input value={form.supplierLegalName} onChange={(e) => set("supplierLegalName", e.target.value)} />
          </Field>
          <Field label="Trade name">
            <Input value={form.supplierTradeName} onChange={(e) => set("supplierTradeName", e.target.value)} />
          </Field>
          <Field label="GSTIN">
            <Input value={form.supplierGstin} onChange={(e) => set("supplierGstin", e.target.value)} />
          </Field>
          <Field label="PAN">
            <Input value={form.supplierPan} onChange={(e) => set("supplierPan", e.target.value)} />
          </Field>
          <Field label="State">
            <Input value={form.supplierState} onChange={(e) => set("supplierState", e.target.value)} />
          </Field>
          <Field label="State code">
            <Input value={form.supplierStateCode} onChange={(e) => set("supplierStateCode", e.target.value)} />
          </Field>
          <Field label="Email">
            <Input value={form.supplierEmail} onChange={(e) => set("supplierEmail", e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={form.supplierPhone} onChange={(e) => set("supplierPhone", e.target.value)} />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Address">
            <Textarea rows={2} value={form.supplierAddress} onChange={(e) => set("supplierAddress", e.target.value)} />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Logo path (absolute path on server, optional)">
            <Input value={form.logoPath} onChange={(e) => set("logoPath", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card className="mb-4">
        <p className="mb-3 text-sm font-medium text-ink">Numbering & billing defaults</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Number prefix">
            <Input value={form.prefix} onChange={(e) => set("prefix", e.target.value)} />
          </Field>
          <Field label="FY start month (1–12)">
            <Input type="number" value={form.fyStartMonth} onChange={(e) => set("fyStartMonth", e.target.value)} />
          </Field>
          <Field label="Number padding">
            <Input type="number" value={form.numberPadding} onChange={(e) => set("numberPadding", e.target.value)} />
          </Field>
          <Field label="Next invoice number">
            <Input
              type="number"
              value={form.nextInvoiceNumber}
              onChange={(e) => set("nextInvoiceNumber", e.target.value)}
            />
          </Field>
          <Field label="Default currency">
            <Input value={form.defaultCurrency} onChange={(e) => set("defaultCurrency", e.target.value)} />
          </Field>
          <Field label="Default tax %">
            <Input type="number" value={form.defaultTaxPercent} onChange={(e) => set("defaultTaxPercent", e.target.value)} />
          </Field>
          <Field label="Default due days">
            <Input type="number" value={form.defaultDueDays} onChange={(e) => set("defaultDueDays", e.target.value)} />
          </Field>
          <Field label="Default SAC/HSN">
            <Input value={form.defaultSac} onChange={(e) => set("defaultSac", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card className="mb-4">
        <p className="mb-3 text-sm font-medium text-ink">Bank / UPI & PDF presentation</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bank details (shown on PDF when unpaid)">
            <Textarea rows={3} value={form.bankDetails} onChange={(e) => set("bankDetails", e.target.value)} />
          </Field>
          <Field label="UPI ID">
            <Input value={form.upiId} onChange={(e) => set("upiId", e.target.value)} />
          </Field>
          <Field label="Signatory name">
            <Input value={form.signatoryName} onChange={(e) => set("signatoryName", e.target.value)} />
          </Field>
          <Field label="PDF footer">
            <Input value={form.pdfFooter} onChange={(e) => set("pdfFooter", e.target.value)} />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="PDF terms">
            <Textarea rows={2} value={form.pdfTerms} onChange={(e) => set("pdfTerms", e.target.value)} />
          </Field>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </>
  );
}
