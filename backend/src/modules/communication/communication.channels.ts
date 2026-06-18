import { query } from "../../db/postgres";
import { sendMail } from "../../utils/mailer";
import { sendPush } from "../../utils/fcm";
import { sendSms } from "../../utils/sms";

/**
 * Best-effort fan-out of an in-app message to recipients' email, SMS and push.
 * Each channel degrades gracefully when unconfigured; this never throws, so a
 * delivery problem can't fail the originating request. Call fire-and-forget.
 */
export async function dispatchExternal(
  institutionId: string,
  userIds: string[],
  subject: string,
  body: string
): Promise<void> {
  if (userIds.length === 0) return;
  try {
    const { rows: users } = await query<{
      email: string;
      phone: string | null;
    }>(
      `SELECT email, phone FROM users
       WHERE institution_id = $1 AND id = ANY($2::uuid[])`,
      [institutionId, userIds]
    );
    const { rows: tokens } = await query<{ token: string }>(
      `SELECT token FROM device_tokens
       WHERE institution_id = $1 AND user_id = ANY($2::uuid[])`,
      [institutionId, userIds]
    );

    const jobs: Array<Promise<unknown>> = [];
    for (const u of users) {
      if (u.email) jobs.push(sendMail({ to: u.email, subject, text: body }));
      if (u.phone) jobs.push(sendSms({ to: u.phone, body: `${subject}: ${body}` }));
    }
    if (tokens.length > 0) {
      jobs.push(
        sendPush({ tokens: tokens.map((t) => t.token), title: subject, body })
      );
    }
    await Promise.allSettled(jobs);
  } catch (err) {
    console.error("dispatchExternal failed:", err);
  }
}
