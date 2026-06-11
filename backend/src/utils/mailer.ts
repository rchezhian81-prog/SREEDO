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
