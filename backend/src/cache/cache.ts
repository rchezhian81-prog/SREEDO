/**
 * Tiny in-process TTL cache for hot read paths. Per-instance (suits the
 * single-VPS target); short TTLs bound staleness and explicit invalidation keeps
 * cached reads correct after writes. Keys MUST be namespaced and include the
 * institution_id (and user/role where relevant) so nothing leaks across tenants
 * or users. Never cache secrets or per-request-authorized private data here.
 */

interface Entry {
  value: unknown;
  expiresAt: number;
}

const store = new Map<string, Entry>();
let hits = 0;
let misses = 0;
let invalidations = 0;

/** Reads a live (non-expired) entry, recording a hit/miss. */
export function getCached<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) {
    misses += 1;
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    misses += 1;
    return undefined;
  }
  hits += 1;
  return entry.value as T;
}

export function setCached(key: string, value: unknown, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** Get-or-load: returns the cached value, else runs `loader`, caches, returns it. */
export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = getCached<T>(key);
  if (hit !== undefined) return hit;
  const value = await loader();
  setCached(key, value, ttlMs);
  return value;
}

/** Removes one key (counts as an invalidation only if it was present). */
export function invalidate(key: string): void {
  if (store.delete(key)) invalidations += 1;
}

/** Removes every key starting with `prefix` (e.g. all of a tenant's entries). */
export function invalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      invalidations += 1;
    }
  }
}

/** Clears all entries (does not reset counters). For tests / ops. */
export function clearCache(): void {
  store.clear();
}

/** Resets the hit/miss/invalidation counters (does not clear entries). For tests. */
export function resetCacheStats(): void {
  hits = 0;
  misses = 0;
  invalidations = 0;
}

export interface CacheStats {
  hits: number;
  misses: number;
  invalidations: number;
  size: number;
}

export function cacheStats(): CacheStats {
  return { hits, misses, invalidations, size: store.size };
}
