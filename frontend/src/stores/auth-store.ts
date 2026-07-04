import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SupportModeState, SupportSessionContext, User } from "@/types";

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  /**
   * Support-mode overlay. `null` for a normal session — every support-related
   * branch (here, in `api.ts`, the layout and the banner) guards on this being
   * non-null, so behaviour is byte-for-byte unchanged while it is null.
   */
  support: SupportModeState | null;
  setSession: (session: {
    user: User;
    accessToken: string;
    refreshToken: string;
  }) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  /**
   * Enter support mode: stash the operator's own token/user, then swap the
   * active identity to the target's scoped impersonation token. No-ops (returns
   * the current state unchanged) unless a real operator session is present.
   */
  enterSupport: (payload: {
    token: string;
    user: User;
    session: Omit<SupportSessionContext, "startedAt">;
  }) => void;
  /** Leave support mode: restore the operator's token/user and clear the overlay. */
  exitSupport: () => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      support: null,
      setSession: ({ user, accessToken, refreshToken }) =>
        set({ user, accessToken, refreshToken }),
      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken }),
      enterSupport: ({ token, user, session }) =>
        set((state) => {
          // Guard: only swap identity when a real operator session exists.
          if (!state.accessToken || !state.user) return state;
          return {
            support: {
              operatorToken: state.accessToken,
              operatorUser: state.user,
              session: { ...session, startedAt: new Date().toISOString() },
            },
            accessToken: token,
            user,
          };
        }),
      exitSupport: () =>
        set((state) => {
          if (!state.support) return state;
          return {
            accessToken: state.support.operatorToken,
            user: state.support.operatorUser,
            support: null,
          };
        }),
      logout: () =>
        set({ user: null, accessToken: null, refreshToken: null, support: null }),
    }),
    { name: "sreedo-auth" }
  )
);
