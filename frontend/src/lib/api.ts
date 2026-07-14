import { useAuthStore } from "@/stores/auth-store";
import { toast } from "@/components/toast";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Machine-readable code from the server (e.g. INSTITUTION_SUSPENDED). */
    public readonly code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let refreshPromise: Promise<boolean> | null = null;

/** Single-flight token refresh shared across concurrent 401s. */
async function refreshSession(): Promise<boolean> {
  refreshPromise ??= (async () => {
    const { refreshToken, setTokens, logout, support } = useAuthStore.getState();
    // A 401 during support mode means the scoped impersonation token expired or
    // was revoked. Never resurrect the operator's token from here — surface the
    // 401 so support mode ends. Inert (falls through) when not in support mode.
    if (support) return false;
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        logout();
        return false;
      }
      const data = await res.json();
      setTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
  allowRetry = true
): Promise<T> {
  // An explicit token (e.g. the scoped 2FA setup token used before a session
  // exists) overrides the stored session and is never eligible for refresh.
  const token = options.token ?? useAuthStore.getState().accessToken;
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401 && allowRetry && !options.token && path !== "/auth/login") {
    if (await refreshSession()) {
      return request(path, options, false);
    }
  }

  if (!res.ok) {
    let message = res.statusText;
    let code: string | undefined;
    try {
      const data = await res.json();
      if (typeof data.error === "string") message = data.error;
      if (data.details && typeof data.details.code === "string") code = data.details.code;
    } catch {
      // non-JSON error body — keep statusText
    }
    // Tenant suspension (PR-SEC2): the institution was suspended/deactivated. End
    // the session and route to the dedicated screen — except on the login request
    // itself, where the login page shows the message inline. Never hijack a
    // support session (the operator's scope is handled below).
    if (
      code === "INSTITUTION_SUSPENDED" &&
      path !== "/auth/login" &&
      !useAuthStore.getState().support &&
      typeof window !== "undefined"
    ) {
      try {
        useAuthStore.getState().logout();
      } catch {
        // best-effort — still redirect below
      }
      if (!window.location.pathname.startsWith("/suspended")) {
        window.location.href = "/suspended";
      }
    }
    // Support mode only: a 403 means the server's scope enforcement blocked this
    // action for the impersonated user — surface it gracefully. Inert otherwise.
    if (res.status === 403 && useAuthStore.getState().support) {
      toast.error(message || "This action is outside the support session's scope.");
    }
    throw new ApiError(res.status, message, code);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string, token?: string) => request<T>(path, { token }),
  post: <T>(path: string, body?: unknown, token?: string) =>
    request<T>(path, { method: "POST", body, token }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body }),
  delete: <T = void>(path: string) => request<T>(path, { method: "DELETE" }),
};
