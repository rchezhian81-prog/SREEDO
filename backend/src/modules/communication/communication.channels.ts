import { query } from "../../db/postgres";
import { sendMail } from "../../utils/mailer";
import { sendPush } from "../../utils/fcm";
import { sendSms } from "../../utils/sms";

export interface ChannelRecipients {
  emails: string[];
  phones: string[];
  pushTokens: string[];
}

/**
 * Resolve which addresses/tokens should actually receive a notification, after
 * applying each recipient's per-channel preferences. A user with no preferences
 * row is treated as opted in to everything (COALESCE(..., true)).
 */
export async function channelRecipients(
  institutionId: string,
  userIds: string[]
): Promise<ChannelRecipients> {
  if (userIds.length === 0) return { emails: [], phones: [], pushTokens: [] };
  const { rows: users } = await query<{
    id: string;
    email: string | null;
    phone: string | null;
    email_enabled: boolean;
    sms_enabled: boolean;
    push_enabled: boolean;
  }>(
    `SELECT u.id, u.email, u.phone,
            COALESCE(np.email_enabled, true) AS email_enabled,
            COALESCE(np.sms_enabled, true) AS sms_enabled,
            COALESCE(np.push_enabled, true) AS push_enabled
     FROM users u
     LEFT JOIN notification_preferences np ON np.user_id = u.id
     WHERE u.institution_id = $1 AND u.id = ANY($2::uuid[])`,
    [institutionId, userIds]
  );

  const pushUserIds = users.filter((u) => u.push_enabled).map((u) => u.id);
  const tokens =
    pushUserIds.length > 0
      ? (
          await query<{ token: string }>(
            `SELECT token FROM device_tokens
             WHERE institution_id = $1 AND user_id = ANY($2::uuid[])`,
            [institutionId, pushUserIds]
          )
        ).rows
      : [];

  return {
    emails: users
      .filter((u) => u.email && u.email_enabled)
      .map((u) => u.email as string),
    phones: users
      .filter((u) => u.phone && u.sms_enabled)
      .map((u) => u.phone as string),
    pushTokens: tokens.map((t) => t.token),
  };
}

/**
 * Best-effort fan-out of an in-app message to recipients' email, SMS and push,
 * respecting each recipient's notification preferences. Each channel degrades
 * gracefully when unconfigured; this never throws, so a delivery problem can't
 * fail the originating request. Call fire-and-forget.
 */
export async function dispatchExternal(
  institutionId: string,
  userIds: string[],
  subject: string,
  body: string
): Promise<void> {
  if (userIds.length === 0) return;
  try {
    const { emails, phones, pushTokens } = await channelRecipients(
      institutionId,
      userIds
    );
    const jobs: Array<Promise<unknown>> = [];
    for (const email of emails) jobs.push(sendMail({ to: email, subject, text: body }));
    for (const phone of phones)
      jobs.push(sendSms({ to: phone, body: `${subject}: ${body}` }));
    if (pushTokens.length > 0) {
      jobs.push(sendPush({ tokens: pushTokens, title: subject, body }));
    }
    await Promise.allSettled(jobs);
  } catch (err) {
    console.error("dispatchExternal failed:", err);
  }
}
