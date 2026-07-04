export type UserRole =
  | "super_admin"
  | "admin"
  | "teacher"
  | "accountant"
  | "student"
  | "parent";

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  institutionId: string | null;
  /** Refresh-token (session) id carried in the access token, for "this device". */
  sessionId?: string;
}

/**
 * Support-access (impersonation) claim carried inside an access token issued for
 * a governed support session (Super Admin G). Its presence distinguishes a
 * support token from a normal one; `enforceSupportScope` reads it to gate the
 * request. A normal token has NO `imp` claim, so `req.support` is null.
 */
export interface SupportImpersonationClaim {
  /** platform_impersonation_sessions.id — the stateful, revocable session row. */
  sid: string;
  /** The real super-admin who started the session (audit attribution). */
  actorId: string;
  scope: "read_only" | "write_enabled" | "module_limited";
  /** Allowed module keys when scope = module_limited. */
  modules?: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      /**
       * Support-session context when the caller bears a support token, else null.
       * Populated by `authenticate` from the token's `imp` claim (Super Admin G).
       */
      support?: SupportImpersonationClaim | null;
      /** Raw request body bytes, captured for webhook signature verification. */
      rawBody?: Buffer;
      /** Correlation id (incoming x-request-id or generated); echoed in responses. */
      requestId?: string;
      /** Platform API-token identity (set by authenticatePlatformToken). */
      platformToken?: { id: string; name: string; scopes: string[] };
    }
  }
}
