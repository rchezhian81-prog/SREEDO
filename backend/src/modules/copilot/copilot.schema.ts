// PR-T11 — AI Copilot request validation. One conversational input; bounded
// so a prompt can never be abused as a bulk-data channel.

import { z } from "zod";

export const copilotAskSchema = z.object({
  message: z.string().trim().min(2).max(2000),
  conversationId: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
});
