import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env";

let transporter: Transporter | null = null;

if (env.smtpHost) {
  transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,
    auth:
      env.smtpUser && env.smtpPass
        ? { user: env.smtpUser, pass: env.smtpPass }
        : undefined,
  });
}

/** Whether an SMTP transport is configured (SMTP_HOST is set). */
export function mailerConfigured(): boolean {
  return transporter !== null;
}

/**
 * Verify SMTP connectivity. Safe to call at boot — never throws. Returns a
 * structured status so the server can log a clear warning instead of silently
 * dropping every transactional email at send time.
 */
export async function verifyMailer(): Promise<{
  configured: boolean;
  ok: boolean;
  error?: string;
}> {
  if (!transporter) return { configured: false, ok: false };
  try {
    await transporter.verify();
    return { configured: true, ok: true };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Send a one-off test email and REPORT the outcome (unlike fire-and-forget
 * `sendMail`). Used by the admin "send test email" tool to validate config.
 */
export async function sendTestEmail(
  to: string
): Promise<{ ok: boolean; error?: string }> {
  if (!transporter) return { ok: false, error: "SMTP is not configured" };
  try {
    await transporter.sendMail({
      from: env.smtpFrom,
      to,
      subject: "SRE EDU OS — SMTP test email",
      text:
        "This is a test email from SRE EDU OS confirming that your SMTP " +
        "configuration is working. If you received this, transactional email " +
        "(password resets, notifications) is deliverable.",
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Fire-and-forget transactional email. A missing SMTP configuration or a
 * delivery failure must never fail the originating request.
 */
export async function sendMail(options: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  if (!transporter) {
    console.warn(`SMTP not configured — skipping email to ${options.to}`);
    return;
  }
  try {
    await transporter.sendMail({ from: env.smtpFrom, ...options });
  } catch (err) {
    console.error(`Failed to send email to ${options.to}:`, err);
  }
}

/**
 * Like `sendMail` but REPORTS the outcome (sent / skipped / failed) instead of
 * swallowing it, while still never throwing. Used where the caller must record
 * whether a transactional email actually went out (e.g. the Support-Access
 * tenant notification, which persists the delivery result on the session row).
 */
export async function deliverMail(options: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ status: "sent" | "skipped" | "failed"; error?: string }> {
  if (!transporter) return { status: "skipped" };
  try {
    await transporter.sendMail({ from: env.smtpFrom, ...options });
    return { status: "sent" };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
