import { env } from "../config/env";

export interface SmsResult {
  status: "sent" | "skipped" | "failed";
  detail?: string;
}

/**
 * Provider-agnostic SMS send. The provider is configured purely via env
 * (SMS_PROVIDER/SMS_API_URL/SMS_API_KEY) — no credentials are hardcoded. When
 * unconfigured it is a no-op ("skipped"); it never throws.
 */
export async function sendSms(opts: {
  to: string;
  body: string;
}): Promise<SmsResult> {
  if (!env.smsProvider || !env.smsApiUrl || !env.smsApiKey) {
    console.warn(`SMS not configured — skipping SMS to ${opts.to}`);
    return { status: "skipped" };
  }
  try {
    const res = await fetch(env.smsApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.smsApiKey}`,
      },
      body: JSON.stringify({
        provider: env.smsProvider,
        to: opts.to,
        from: env.smsSender,
        message: opts.body,
      }),
    });
    if (!res.ok) return { status: "failed", detail: `HTTP ${res.status}` };
    return { status: "sent" };
  } catch (err) {
    console.error(`SMS send failed to ${opts.to}:`, err);
    return { status: "failed", detail: (err as Error).message };
  }
}

export const smsConfigured = (): boolean =>
  Boolean(env.smsProvider && env.smsApiUrl && env.smsApiKey);
