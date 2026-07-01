"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";

interface GatewaySettings {
  provider: string;
  enabled: boolean;
  keyId: string | null;
  defaultCurrency: string;
  updatedAt: string | null;
  keySecretSet: boolean;
  webhookSecretSet: boolean;
  keySecretMasked: string | null;
  webhookSecretMasked: string | null;
  keySecretSource: "db" | "env" | null;
  webhookSecretSource: "db" | "env" | null;
  configured: boolean;
  // B4 recurring & dunning policy.
  autoChargeEnabled: boolean;
  dunningMaxAttempts: number;
  dunningRetryIntervalDays: number;
  suspendOnDunningExhausted: boolean;
  renewalLeadDays: number;
  recurringActive: boolean;
}

export default function PaymentGatewayPage() {
  const router = useRouter();
  const [data, setData] = useState<GatewaySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Form fields. Secrets start blank; a blank secret on save keeps the stored one.
  const [enabled, setEnabled] = useState(false);
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [currency, setCurrency] = useState("INR");
  // B4 recurring & dunning policy (OFF by default).
  const [autoChargeEnabled, setAutoChargeEnabled] = useState(false);
  const [dunningMaxAttempts, setDunningMaxAttempts] = useState("3");
  const [dunningRetryIntervalDays, setDunningRetryIntervalDays] = useState("3");
  const [suspendOnExhausted, setSuspendOnExhausted] = useState(true);
  const [renewalLeadDays, setRenewalLeadDays] = useState("0");

  const apply = (s: GatewaySettings) => {
    setData(s);
    setEnabled(s.enabled);
    setKeyId(s.keyId ?? "");
    setCurrency(s.defaultCurrency ?? "INR");
    setKeySecret("");
    setWebhookSecret("");
    setAutoChargeEnabled(s.autoChargeEnabled);
    setDunningMaxAttempts(String(s.dunningMaxAttempts));
    setDunningRetryIntervalDays(String(s.dunningRetryIntervalDays));
    setSuspendOnExhausted(s.suspendOnDunningExhausted);
    setRenewalLeadDays(String(s.renewalLeadDays));
  };

  useEffect(() => {
    (async () => {
      try {
        apply(await api.get<GatewaySettings>("/platform/payment-gateway"));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load gateway settings");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.patch<GatewaySettings>("/platform/payment-gateway", {
        provider: "razorpay",
        enabled,
        keyId: keyId.trim() || null,
        defaultCurrency: currency.trim() || "INR",
        // Blank = keep the stored secret (backend ignores empty secrets).
        keySecret: keySecret,
        webhookSecret: webhookSecret,
        // B4 recurring & dunning policy.
        autoChargeEnabled,
        dunningMaxAttempts: Number(dunningMaxAttempts),
        dunningRetryIntervalDays: Number(dunningRetryIntervalDays),
        suspendOnDunningExhausted: suspendOnExhausted,
        renewalLeadDays: Number(renewalLeadDays),
      });
      apply(updated);
      setNotice("Payment gateway settings saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save gateway settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;
  if (!data) return <ErrorNote message={error ?? "Gateway settings unavailable"} />;

  const webhookPath = "/api/v1/platform/payments/webhook";

  return (
    <>
      <PageHeader
        title="Payment gateway"
        subtitle="Razorpay online payment for SaaS subscription invoices — super-admin"
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

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={data.configured ? "green" : "slate"}>
          {data.configured ? "Configured" : "Not configured"}
        </Badge>
        <Badge tone={data.enabled ? "green" : "slate"}>{data.enabled ? "Enabled" : "Disabled"}</Badge>
        <Badge tone={data.recurringActive ? "green" : "slate"}>
          {data.recurringActive ? "Recurring active" : "Recurring off"}
        </Badge>
        <span className="text-xs text-muted">Provider: {data.provider}</span>
        {data.updatedAt && (
          <span className="text-xs text-faint">
            Updated {new Date(data.updatedAt).toLocaleString()}
          </span>
        )}
      </div>

      <Card className="mb-4">
        <p className="mb-3 text-sm font-medium text-ink">Razorpay credentials</p>
        <label className="mb-3 flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-line"
          />
          Enable online payment for SaaS invoices
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Key ID" hint="Razorpay key id (e.g. rzp_live_… / rzp_test_…). Not secret.">
            <Input value={keyId} onChange={(e) => setKeyId(e.target.value)} placeholder="rzp_test_xxxxxxxx" />
          </Field>
          <Field label="Default currency">
            <Input value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </Field>
          <Field
            label="Key secret"
            hint={
              data.keySecretSet
                ? `Stored (${data.keySecretMasked}${data.keySecretSource === "env" ? ", from env" : ""}). Leave blank to keep.`
                : "Not set."
            }
          >
            <Input
              type="password"
              value={keySecret}
              onChange={(e) => setKeySecret(e.target.value)}
              placeholder={data.keySecretSet ? "•••••••• (unchanged)" : "Enter key secret"}
            />
          </Field>
          <Field
            label="Webhook secret"
            hint={
              data.webhookSecretSet
                ? `Stored (${data.webhookSecretMasked}${data.webhookSecretSource === "env" ? ", from env" : ""}). Leave blank to keep.`
                : "Not set."
            }
          >
            <Input
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder={data.webhookSecretSet ? "•••••••• (unchanged)" : "Enter webhook secret"}
            />
          </Field>
        </div>
        <div className="mt-4">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save gateway settings"}
          </Button>
        </div>
      </Card>

      <Card className="mb-4">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-ink">Recurring &amp; dunning</p>
          <Badge tone={data.recurringActive ? "green" : "slate"}>
            {data.recurringActive ? "Active" : "Off"}
          </Badge>
        </div>
        <p className="mb-3 text-xs text-faint">
          Off by default. Auto-charge and dunning only run when this master switch is on{" "}
          <strong>and</strong> the gateway above is enabled + configured. Renewals are charged only
          for tenants whose subscription has auto-renew and auto-charge turned on. Nothing is charged
          or suspended until you opt in.
        </p>
        <label className="mb-3 flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={autoChargeEnabled}
            onChange={(e) => setAutoChargeEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-line"
          />
          Enable online recurring auto-charge &amp; dunning (master switch)
        </label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Dunning max attempts" hint="1–10 retries before giving up">
            <Input
              type="number"
              min={1}
              max={10}
              value={dunningMaxAttempts}
              onChange={(e) => setDunningMaxAttempts(e.target.value)}
            />
          </Field>
          <Field label="Retry interval (days)" hint="1–30 days between retries">
            <Input
              type="number"
              min={1}
              max={30}
              value={dunningRetryIntervalDays}
              onChange={(e) => setDunningRetryIntervalDays(e.target.value)}
            />
          </Field>
          <Field label="Renewal lead (days)" hint="0–30; how early to raise the renewal invoice">
            <Input
              type="number"
              min={0}
              max={30}
              value={renewalLeadDays}
              onChange={(e) => setRenewalLeadDays(e.target.value)}
            />
          </Field>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={suspendOnExhausted}
            onChange={(e) => setSuspendOnExhausted(e.target.checked)}
            className="h-4 w-4 rounded border-line"
          />
          Suspend the tenant when dunning is exhausted (reversible; data is retained)
        </label>
        <div className="mt-4">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save recurring & dunning"}
          </Button>
        </div>
      </Card>

      <Card>
        <p className="mb-2 text-sm font-medium text-ink">Webhook endpoint</p>
        <p className="mb-2 text-sm text-muted">
          In the Razorpay dashboard, add a webhook pointing at this path on your API host, using the
          webhook secret above. Subscribe to the <code>payment_link.paid</code> and{" "}
          <code>payment.captured</code> events.
        </p>
        <code className="block rounded-lg border border-line bg-app px-3 py-2 text-xs text-ink">
          {`https://<your-api-host>${webhookPath}`}
        </code>
        <p className="mt-3 text-xs text-faint">
          Secrets are stored encrypted-at-rest by your database and are never returned by the API —
          only a masked preview is shown. When the gateway is disabled, invoices are collected offline
          (Mark paid) exactly as before.
        </p>
      </Card>
    </>
  );
}
