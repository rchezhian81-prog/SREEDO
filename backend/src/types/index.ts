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
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      /** Raw request body bytes, captured for webhook signature verification. */
      rawBody?: Buffer;
    }
  }
}
