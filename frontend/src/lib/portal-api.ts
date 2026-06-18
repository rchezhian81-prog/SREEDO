import { ApiError } from "./api";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

let refreshing: Promise<boolean> | null = null;

/** Single-flight cookie refresh shared across concurrent 401s. */
async function tryRefresh(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const r = await fetch(`${API_URL}/auth/portal/refresh`, {
        method: "POST",
        credentials: "include",
      });
      return r.ok;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function req<T>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
  retry = true
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? "GET",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && retry && !path.startsWith("/auth/portal/login")) {
    if (await tryRefresh()) return req<T>(path, opts, false);
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const d = await res.json();
      if (typeof d.error === "string") message = d.error;
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const portalApi = {
  get: <T>(p: string) => req<T>(p),
  post: <T>(p: string, body?: unknown) => req<T>(p, { method: "POST", body }),
};
