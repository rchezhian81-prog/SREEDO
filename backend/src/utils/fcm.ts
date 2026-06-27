import { env } from "../config/env";

export interface PushResult {
  status: "sent" | "skipped" | "failed";
  detail?: string;
}

/**
 * Firebase Cloud Messaging push to device tokens. Configured via FCM_SERVER_KEY;
 * a no-op ("skipped") when unset or with no tokens. Never throws.
 */
export async function sendPush(opts: {
  tokens: string[];
  title: string;
  body: string;
}): Promise<PushResult> {
  if (!env.fcmServerKey) {
    console.warn("FCM not configured — skipping push");
    return { status: "skipped" };
  }
  if (opts.tokens.length === 0) return { status: "skipped" };
  try {
    const res = await fetch("https://fcm.googleapis.com/fcm/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `key=${env.fcmServerKey}`,
      },
      body: JSON.stringify({
        registration_ids: opts.tokens,
        notification: { title: opts.title, body: opts.body },
      }),
    });
    if (!res.ok) return { status: "failed", detail: `HTTP ${res.status}` };
    return { status: "sent" };
  } catch (err) {
    console.error("FCM push failed:", err);
    return { status: "failed", detail: (err as Error).message };
  }
}

export const fcmConfigured = (): boolean => Boolean(env.fcmServerKey);
