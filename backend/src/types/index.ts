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

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      /** Raw request body bytes, captured for webhook signature verification. */
      rawBody?: Buffer;
      /** Correlation id (incoming x-request-id or generated); echoed in responses. */
      requestId?: string;
    }
  }
}
