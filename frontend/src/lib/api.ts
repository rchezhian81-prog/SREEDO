import { useAuthStore } from "@/stores/auth-store";
import { toast } from "@/components/toast";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
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
    try {
      const data = await res.json();
      if (typeof data.error === "string") message = data.error;
    } catch {
      // non-JSON error body — keep statusText
    }
    // Support mode only: a 403 means the server's scope enforcement blocked this
    // action for the impersonated user — surface it gracefully. Inert otherwise.
    if (res.status === 403 && useAuthStore.getState().support) {
      toast.error(message || "This action is outside the support session's scope.");
    }
    throw new ApiError(res.status, message);
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
