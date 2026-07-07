import { z } from "zod";

// Switch the tenant between school and college mode. `institutions.type` is the
// single source of truth; this is the canonical endpoint that mutates it.
export const switchModeSchema = z.object({
  type: z.enum(["school", "college"]),
});
