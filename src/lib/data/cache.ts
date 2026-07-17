type CacheEntry<T> = { value: T; expiresAt: number };

const store = new Map<string, CacheEntry<unknown>>();

/** Simple in-memory TTL cache (per serverless instance / long-lived node). */
export function cachedGet<T>(key: string): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    store.delete(key);
    return null;
  }
  return hit.value as T;
}

export function cachedSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export async function withCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const hit = cachedGet<T>(key);
  if (hit != null) return hit;
  const value = await loader();
  cachedSet(key, value, ttlMs);
  return value;
}

export const CACHE_TTL = {
  espn: 10 * 60_000,
  /** Free plan ~100 req/day — long TTL; window cached as one key. */
  apiFootball: 30 * 60_000,
  oddsApi: 45 * 60_000,
  pandascore: 15 * 60_000,
} as const;
